import * as pty from 'node-pty'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { isInheritedSessionVar } from './claude-launch.ts'
import type { ClaudeAccountState, ClaudeAccountView } from '../shared/claude-accounts-types.ts'
import { resolveCommand } from './terminals.ts'

/** One Claude Code login. The built-in `default` account has no config dir of its own: it is
 *  whatever plain `claude` uses (~/.claude), so default behaviour is unchanged. Others live in
 *  `<root>/<id>` and are selected with CLAUDE_CONFIG_DIR. Tokens are never read, logged or
 *  copied here: `claude auth status` is the only thing that looks at the credentials. */
export interface ClaudeAccount {
  id: string
  name: string
  /** null for the default account. */
  configDir: string | null
}

interface Stored {
  accounts: ClaudeAccount[]
  activeId: string
  /** mission id → account id: every session of a mission uses the account it started with. */
  missions: Record<string, string>
}

const DefaultAccount: ClaudeAccount = { id: 'default', name: 'Default', configDir: null }
const Ansi = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g

interface Login {
  term: pty.IPty
  url: string | null
  error: string | null
  done: boolean
}

export class ClaudeAccounts {
  private root = ''
  private file = ''
  private data: Stored = { accounts: [], activeId: 'default', missions: {} }
  private readonly logins = new Map<string, Login>()
  private readonly status = new Map<string, Partial<ClaudeAccountView>>()
  onChange: () => void = () => {}

  /** `root` is the app data folder for accounts (e.g. <userData>/claude-accounts). */
  init(root: string): void {
    this.root = root
    this.file = path.join(root, 'accounts.json')
    try {
      const p = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<Stored>
      this.data = {
        accounts: (p.accounts ?? []).filter((a) => a?.id && a.configDir),
        activeId: p.activeId ?? 'default',
        missions: p.missions ?? {}
      }
    } catch {
      // first run
    }
    if (!this.find(this.data.activeId)) this.data.activeId = 'default'
  }

  private save(): void {
    if (!this.file) return
    fs.mkdirSync(this.root, { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2))
  }

  private find(id: string): ClaudeAccount | undefined {
    return id === 'default' ? DefaultAccount : this.data.accounts.find((a) => a.id === id)
  }

  /** CLAUDE_CONFIG_DIR for an account id; null = plain `claude` (default account). */
  configDirOf(id: string | null | undefined): string | null {
    return (id ? this.find(id)?.configDir : null) ?? null
  }

  activeConfigDir(): string | null {
    return this.configDirOf(this.data.activeId)
  }

  /** The config dir a mission's sessions use: pinned on first call to the active account, so a
   *  later change of the active account never splits a running mission across logins. */
  configDirForMission(missionId: string): string | null {
    let id = this.data.missions[missionId]
    if (!id || !this.find(id)) {
      id = this.data.activeId
      this.data.missions[missionId] = id
      this.save()
    }
    return this.configDirOf(id)
  }

  forgetMission(missionId: string): void {
    if (delete this.data.missions[missionId]) this.save()
  }

  async list(): Promise<ClaudeAccountView[]> {
    const all = [DefaultAccount, ...this.data.accounts]
    return Promise.all(all.map((a) => this.view(a)))
  }

  private async view(a: ClaudeAccount): Promise<ClaudeAccountView> {
    const login = this.logins.get(a.id)
    const base: ClaudeAccountView = {
      id: a.id,
      name: a.name,
      isDefault: a.id === 'default',
      active: a.id === this.data.activeId,
      state: 'logged-out',
      email: null,
      plan: null,
      expiresAt: null,
      error: null,
      loginUrl: null
    }
    if (login && !login.done) return { ...base, state: 'logging-in', loginUrl: login.url }
    const s = await this.probe(a)
    return { ...base, ...s, error: s.error ?? login?.error ?? null }
  }

  /** `claude auth status --json` under the account's config dir. Reports login state only. */
  private probe(a: ClaudeAccount): Promise<Partial<ClaudeAccountView>> {
    return new Promise((resolve) => {
      execFile('claude', ['auth', 'status', '--json'], { timeout: 10_000, env: this.env(a.configDir) }, (err, stdout) => {
        try {
          const j = JSON.parse(stdout) as { loggedIn?: boolean; email?: string; subscriptionType?: string; planTier?: string; loginExpiresAt?: string }
          if (!j.loggedIn) return resolve({ state: 'logged-out' })
          const exp = j.loginExpiresAt ? Date.parse(j.loginExpiresAt) : NaN
          resolve({
            state: !Number.isNaN(exp) && exp < Date.now() ? 'expired' : 'logged-in',
            email: j.email ?? null,
            plan: j.planTier ?? j.subscriptionType ?? null,
            expiresAt: j.loginExpiresAt ?? null
          })
        } catch {
          resolve(err ? { state: 'error', error: 'Could not run `claude auth status`.' } : { state: 'logged-out' })
        }
      })
    })
  }

  private env(configDir: string | null): Record<string, string> {
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !isInheritedSessionVar(k)) env[k] = v
    if (configDir) env.CLAUDE_CONFIG_DIR = configDir
    else delete env.CLAUDE_CONFIG_DIR
    return env
  }

  /** Creates an account with its own empty config dir and starts its login. */
  add(name: string): string {
    const id = randomBytes(5).toString('hex')
    const configDir = path.join(this.root, id)
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 })
    this.data.accounts.push({ id, name: name.trim() || `Account ${this.data.accounts.length + 1}`, configDir })
    this.save()
    this.login(id)
    return id
  }

  rename(id: string, name: string): void {
    const a = this.data.accounts.find((x) => x.id === id)
    if (!a || !name.trim()) return
    a.name = name.trim()
    this.save()
  }

  /** Runs `claude auth login` in a pty under the account's config dir. */
  login(id: string): void {
    const a = this.find(id)
    if (!a) throw new Error('unknown account')
    this.cancelLogin(id)
    const env = this.env(a.configDir)
    // Never let the CLI pop open a browser we can't see in a headless pty if it can't; the URL
    // is surfaced to the UI either way.
    const term = pty.spawn(resolveCommand('claude', env), ['auth', 'login'], {
      name: 'xterm-256color',
      cols: 200,
      rows: 40,
      cwd: a.configDir ?? process.cwd(),
      env
    })
    const login: Login = { term, url: null, error: null, done: false }
    this.logins.set(id, login)
    let tail = ''
    term.onData((d) => {
      tail = (tail + d.replace(Ansi, '')).slice(-4000)
      const m = tail.match(/https:\/\/\S+/g)
      const url = m ? m[m.length - 1] : null
      if (url && url !== login.url) {
        login.url = url
        this.onChange()
      }
    })
    term.onExit(({ exitCode }) => {
      login.done = true
      if (this.logins.get(id) === login && exitCode !== 0 && !login.error) login.error = 'Login did not finish. Try again.'
      this.onChange()
    })
    this.onChange()
  }

  /** Types the code the browser shows into the waiting login (when the CLI asks for one). */
  submitCode(id: string, code: string): void {
    const l = this.logins.get(id)
    if (l && !l.done) l.term.write(code.trim() + '\r')
  }

  cancelLogin(id: string): void {
    const l = this.logins.get(id)
    if (!l) return
    this.logins.delete(id)
    if (!l.done) {
      l.done = true
      try {
        l.term.kill()
      } catch {
        // already gone
      }
    }
    this.onChange()
  }

  setActive(id: string): void {
    if (!this.find(id)) throw new Error('unknown account')
    this.data.activeId = id
    this.save()
    this.onChange()
  }

  /** Forgets an account and deletes its private config dir. The default account can't be removed. */
  remove(id: string): void {
    const a = this.data.accounts.find((x) => x.id === id)
    if (!a) return
    this.cancelLogin(id)
    this.data.accounts = this.data.accounts.filter((x) => x !== a)
    if (this.data.activeId === id) this.data.activeId = 'default'
    for (const [m, acc] of Object.entries(this.data.missions)) if (acc === id) delete this.data.missions[m]
    this.save()
    // Only ever delete inside our own root.
    if (a.configDir && path.dirname(a.configDir) === this.root) fs.rmSync(a.configDir, { recursive: true, force: true })
    this.onChange()
  }

  shutdown(): void {
    for (const id of [...this.logins.keys()]) this.cancelLogin(id)
  }
}

/** The app-wide store (initialised by registerClaudeAccountsIpc). */
export const claudeAccounts = new ClaudeAccounts()
