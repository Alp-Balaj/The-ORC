import { execFile, spawn, type ChildProcess } from 'node:child_process'
import type { GithubAccountView } from '../shared/types.ts'

// GitHub account via the `gh` CLI. gh keeps the token in its own store (keyring or hosts.yml);
// The ORC never reads, stores or logs it. Pushes use `gh auth git-credential` as the git helper.

const HOST = 'github.com'
let login: ChildProcess | null = null
let connecting: { code: string | null; url: string } | null = null
let lastError: string | null = null

function gh(args: string[], timeoutMs = 15_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile('gh', args, { timeout: timeoutMs, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { code?: unknown }) | null
      if (e && e.code === 'ENOENT') return resolve({ code: 127, out: '' })
      resolve({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, out: `${stdout}\n${stderr}`.trim() })
    })
  })
}

export async function githubStatus(): Promise<GithubAccountView> {
  const base = { connecting: connecting ? { ...connecting } : null, error: lastError }
  const v = await gh(['--version'])
  if (v.code === 127) return { ...base, state: 'missing', user: null }
  if (connecting) return { ...base, state: 'connecting', user: null }
  const s = await gh(['auth', 'status', '--hostname', HOST])
  if (s.code !== 0) return { ...base, state: 'disconnected', user: null }
  const u = await gh(['api', 'user', '--jq', '.login', '--hostname', HOST])
  const user = u.code === 0 ? u.out.split('\n')[0].trim() || null : /account (\S+)/.exec(s.out)?.[1] ?? null
  return { ...base, state: 'connected', user }
}

/** `gh auth login --web`: gh prints a one-time code, we surface it and open the browser. */
export async function githubConnect(): Promise<GithubAccountView> {
  if (login) return githubStatus()
  lastError = null
  connecting = { code: null, url: 'https://github.com/login/device' }
  const child = spawn('gh', ['auth', 'login', '--web', '--hostname', HOST, '--git-protocol', 'https', '--skip-ssh-key'], {
    env: { ...process.env, GH_PROMPT_DISABLED: '', BROWSER: 'true', NO_COLOR: '1' },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  login = child
  let buf = ''
  const onData = (d: Buffer): void => {
    buf += d.toString()
    const m = /code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i.exec(buf)
    if (m && connecting && !connecting.code) {
      connecting.code = m[1]
      // Loaded here, not at the top: mission-git.ts imports this file and tests run it under plain node.
      const url = connecting.url
      void import('electron').then(({ shell }) => shell.openExternal(url))
      child.stdin?.write('\n')
    }
  }
  child.stdout?.on('data', onData)
  child.stderr?.on('data', onData)
  const finish = (err: string | null): void => {
    if (login !== child) return
    login = null
    connecting = null
    if (err) lastError = err
  }
  child.on('error', (e) => finish(e.message))
  child.on('close', (code) => finish(code === 0 ? null : 'GitHub sign-in did not finish. Try again.'))
  setTimeout(() => { if (login === child) child.kill() }, 10 * 60_000).unref()
  return githubStatus()
}

export async function githubCancel(): Promise<GithubAccountView> {
  login?.kill()
  login = null
  connecting = null
  return githubStatus()
}

export async function githubDisconnect(): Promise<GithubAccountView> {
  const r = await gh(['auth', 'logout', '--hostname', HOST])
  lastError = r.code === 0 ? null : 'Could not disconnect: ' + (r.out.split('\n').pop() ?? 'gh failed')
  return githubStatus()
}

/** git `-c` args making a push use gh's credential; empty when gh isn't signed in (cached 30s). */
let credCache: { at: number; args: string[] } | null = null
export async function githubGitArgs(): Promise<string[]> {
  if (credCache && Date.now() - credCache.at < 30_000) return credCache.args
  const s = await gh(['auth', 'status', '--hostname', HOST])
  const args = s.code === 0 ? ['-c', `credential.https://${HOST}.helper=`, '-c', `credential.https://${HOST}.helper=!gh auth git-credential`] : []
  credCache = { at: Date.now(), args }
  return args
}
