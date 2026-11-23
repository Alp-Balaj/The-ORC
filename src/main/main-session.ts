import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { mainSessionKey, mainSessionTerminalId } from '../shared/types.ts'
import type { MainSessionView, PermissionMode } from '../shared/types.ts'
import { claudeArgs, mainSessionPrompt, ownerStatusLine, sessionEnv } from './claude-launch.ts'
import type { HookEvent } from './control-server.ts'
import type { Launcher } from './missions.ts'
import { renameOver } from './rename-over.ts'
import type { TerminalHost } from './terminals.ts'

/** Read-only tools the main session may use without a prompt: mission status, history, messages. */
const MainAllowTools = [
  'mcp__orc__list_missions',
  'mcp__orc__start_mission',
  'mcp__orc__search_history',
  'SendMessage',
  'ListAgents'
]
const MainDenyTools = ['Edit', 'Write', 'NotebookEdit']

interface Saved {
  sessionId: string
  /** Running when The ORC last quit or was told to run it: start it again at launch. */
  wanted: boolean
  /** Its conversation was started at least once, so later launches resume it. */
  launched: boolean
  permissionMode: PermissionMode | null
}

export interface MainSessionOptions {
  terminals: TerminalHost
  /** The space this session oversees (its repo root); the session's cwd. */
  repoPath: string
  repoName: string
  /** The app's data folder: main-sessions/<key>.json and the session's own folder live here. */
  dataDir: string
  /** The permission mode missions use; the main session uses the same one. */
  permissionMode: () => PermissionMode
  changed: (view: MainSessionView) => void
}

function load(file: string): Partial<Saved> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' ? (parsed as Partial<Saved>) : {}
  } catch {
    return {}
  }
}

/** One space's main session: an interactive claude above that repo's missions. It is not a
 *  mission, so Missions never sees it. The old global main-session.json is never read. */
export class MainSession {
  /** How the session is started. Smoke runs swap in a fake command. */
  launcher: Launcher = (args) => ({ command: 'claude', args })
  /** Plan usage from the status line (index.ts sets it); returns the text the line shows. */
  statusLine: (status: unknown) => string | null = () => null
  private controlPort = 0
  readonly repoPath: string
  private readonly repoName: string
  readonly terminalId: string
  private readonly sessionName: string
  private readonly terminals: TerminalHost
  private readonly dir: string
  private readonly file: string
  private readonly currentPermissionMode: () => PermissionMode
  private readonly changed: (view: MainSessionView) => void
  private sessionId: string
  private wanted: boolean
  private launched: boolean
  private mode: PermissionMode | null
  /** Per-launch bearer token; null while not running. */
  private token: string | null = null
  private status: MainSessionView['status'] = 'off'
  private activity = ''
  private resumed = false
  private inTurn = false
  private idlePolls = 0
  private turnIdlePolls = 0

  constructor(o: MainSessionOptions) {
    this.terminals = o.terminals
    this.repoPath = o.repoPath
    this.repoName = o.repoName
    const key = mainSessionKey(o.repoPath)
    this.terminalId = mainSessionTerminalId(o.repoPath)
    this.sessionName = `orc-main-${key.slice(0, 8)}`
    this.dir = join(o.dataDir, 'main-sessions', key)
    this.file = join(o.dataDir, 'main-sessions', `${key}.json`)
    this.currentPermissionMode = o.permissionMode
    this.changed = o.changed
    const saved = load(this.file)
    this.sessionId = typeof saved.sessionId === 'string' ? saved.sessionId : randomUUID()
    this.wanted = saved.wanted === true
    this.launched = saved.launched === true
    // The main session always runs bypassPermissions: a saved older mode never overrides it.
    this.mode = 'bypassPermissions'
  }

  setControlPort(port: number): void {
    this.controlPort = port
  }

  /** Starts the session, or resumes its conversation; a no-op while it runs. */
  start(): void {
    if (this.terminals.isRunning(this.terminalId)) return
    this.launch(this.launched, false)
  }

  /** The owner stops it: it stays down at the next launch. */
  stop(): void {
    this.wanted = false
    this.token = null
    this.inTurn = false
    this.save()
    this.set('off', '')
    this.terminals.kill(this.terminalId)
  }

  /** At launch: brings the session back if it was running when The ORC last quit. */
  restore(): void {
    if (this.wanted) this.launch(this.launched, true)
  }

  view(): MainSessionView {
    return { terminalId: this.terminalId, repoPath: this.repoPath, repoName: this.repoName, sessionName: this.sessionName, status: this.status, activity: this.activity, resumed: this.resumed }
  }

  /** The permission mode the session runs with (what a mission it starts uses too). */
  permissionModeInUse(): PermissionMode {
    return 'bypassPermissions'
  }

  agentForToken(token: string): string | null {
    return this.token && token === this.token ? this.terminalId : null
  }

  /** Hook events from the main session. Returns the hook's stdout, or null for none. */
  hookEvent(e: HookEvent): string | null {
    if (e.hook_event_name === 'OrcStatusLine') return this.statusLine((e as unknown as { status?: unknown }).status)
    if (!this.token) return null
    switch (e.hook_event_name) {
      case 'SessionStart':
        if (this.status === 'starting') this.set('idle', 'ready')
        break
      case 'UserPromptSubmit':
        this.inTurn = true
        this.set('working', 'thinking')
        break
      case 'PreToolUse':
        // A tool running means any permission prompt was answered yes.
        this.inTurn = true
        this.set('working', e.tool_name ? `using ${e.tool_name}` : 'working')
        break
      case 'PostToolUse':
        this.set('working', e.tool_name ? `using ${e.tool_name}` : 'working')
        break
      case 'Notification':
        // Idle-waiting notifications are not "needs you"; permission prompts are.
        if (e.notification_type === 'idle_prompt' || /waiting for your input/i.test(e.message ?? '')) break
        this.set('needs-you', e.message ?? 'needs you')
        break
      case 'Stop':
        this.inTurn = false
        this.set('idle', 'turn finished')
        break
      case 'SessionEnd':
        this.inTurn = false
        this.set('exited', 'session ended')
        break
    }
    return null
  }

  /** The session's process ended. A stop by the owner already set it off. */
  terminalExited(id: string, exitCode = 0): void {
    if (id !== this.terminalId) return
    this.token = null
    this.inTurn = false
    if (this.status === 'off') return
    this.set('exited', exitCode ? `claude exited (code ${exitCode})` : 'session ended')
  }

  /** Session ids worth polling for (see startStatusPoller). */
  liveSessionIds(): string[] {
    return this.token && (this.status === 'working' || this.status === 'needs-you') ? [this.sessionId] : []
  }

  /** Backup status from `claude agents --json`, as Missions.reconcile does for missions. */
  reconcile(states: Map<string, string>): void {
    if (!this.token) return
    const s = states.get(this.sessionId)
    if (this.inTurn && s === 'idle') {
      if (++this.turnIdlePolls >= 2) {
        this.inTurn = false
        this.turnIdlePolls = 0
      }
    } else this.turnIdlePolls = 0
    if (s === 'waiting' && this.status === 'working') {
      this.set('needs-you', 'needs your permission')
      return
    }
    const live = this.status === 'working' || this.status === 'needs-you'
    if (!live || s !== 'idle') {
      this.idlePolls = 0
      return
    }
    if (++this.idlePolls >= 2) {
      this.idlePolls = 0
      this.inTurn = false
      this.set('idle', this.status === 'needs-you' ? 'permission prompt dismissed' : 'interrupted')
    }
  }

  // Internals ---------------------------------------------------------------

  private launch(resume: boolean, restored: boolean): void {
    mkdirSync(this.dir, { recursive: true })
    mkdirSync(dirname(this.file), { recursive: true })
    this.token = randomBytes(24).toString('hex')
    // Fresh start, resume and restore all launch bypassPermissions.
    this.mode = 'bypassPermissions'
    const { command, args } = this.launcher(
      claudeArgs({
        sessionName: this.sessionName,
        sessionId: this.sessionId,
        resume,
        token: this.token,
        controlPort: this.controlPort,
        permissionMode: this.mode,
        ownStatusLine: ownerStatusLine(this.dir),
        systemPrompt: mainSessionPrompt(this.repoName, this.repoPath),
        readDirs: [],
        allowTools: MainAllowTools,
        denyTools: MainDenyTools
      })
    )
    this.wanted = true
    this.launched = true
    this.resumed = restored
    this.inTurn = false
    this.save()
    this.terminals.start({ id: this.terminalId, command, args, cwd: this.repoPath, env: sessionEnv() })
    this.set('starting', 'starting')
  }

  private set(status: MainSessionView['status'], activity: string): void {
    if (status === this.status && activity === this.activity) return
    this.status = status
    this.activity = activity
    this.changed(this.view())
  }

  /** Written only on start and stop, never at shutdown: a quit must not clear `wanted`. */
  private save(): void {
    const saved: Saved = { sessionId: this.sessionId, wanted: this.wanted, launched: this.launched, permissionMode: this.mode }
    try {
      writeFileSync(`${this.file}.tmp`, JSON.stringify(saved))
      renameOver(`${this.file}.tmp`, this.file)
    } catch (err) {
      console.error('could not save the main session', err)
    }
  }
}
