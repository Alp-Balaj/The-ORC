import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { renameOver } from './rename-over.ts'
import type { AppRunView } from '../shared/types.ts'
import { sessionEnv } from './claude-launch.ts'
import { bashPath } from './mission-git.ts'
import type { TerminalHost } from './terminals.ts'

export const appTerminalId = (missionId: string): string => `app:${missionId}`

/** Ends a process and everything it started, so a dev server's port is free once it returns.
 *  A pty's child leads its own process group on Unix; on Windows taskkill walks the tree. */
export function killTree(pid: number): void {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {}
}

/** The app that was running, saved so it comes back after The ORC restarts. */
export interface SavedAppRun {
  missionId: string
  command: string
}

/** Runs the app being built (the space's run command) from one mission's integration
 *  worktree. One at a time: running another mission's app first ends this one and waits for
 *  it to exit, so the new one gets the port. */
export class AppRunner {
  private current: AppRunView | null = null
  private readonly terminals: Pick<TerminalHost, 'start' | 'kill' | 'isRunning' | 'pid'>
  private readonly changed: (run: AppRunView | null) => void
  /** Replaceable in tests. */
  killTree: (pid: number) => void = killTree
  shell: () => string = bashPath
  exitWaitMs = 10_000
  /** Where the running app is saved (`app-run.json`). Null: not saved (tests). */
  file: string | null = null

  constructor(terminals: Pick<TerminalHost, 'start' | 'kill' | 'isRunning' | 'pid'>, changed: (run: AppRunView | null) => void) {
    this.terminals = terminals
    this.changed = changed
  }

  view(): AppRunView | null {
    return this.current
  }

  async run(missionId: string, missionName: string, cwd: string, command: string): Promise<void> {
    await this.stop()
    const terminalId = appTerminalId(missionId)
    const env = sessionEnv()
    // An Electron app being built must not inherit The ORC's own Electron settings.
    for (const k of Object.keys(env)) if (k.startsWith('ELECTRON_')) delete env[k]
    env.FORCE_COLOR = '1'
    this.terminals.start({ id: terminalId, command: this.shell(), args: ['-lc', command], cwd, env })
    this.current = { missionId, missionName, terminalId, command, cwd, status: 'running', exitCode: null, startedAt: Date.now() }
    this.changed(this.current)
    this.persist({ missionId, command })
  }

  /** The app saved by the last run that was not stopped explicitly, if any. */
  saved(): SavedAppRun | null {
    if (!this.file) return null
    try {
      const o = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<SavedAppRun>
      return typeof o.missionId === 'string' && typeof o.command === 'string' ? { missionId: o.missionId, command: o.command } : null
    } catch {
      return null
    }
  }

  private persist(run: SavedAppRun | null): void {
    if (!this.file) return
    try {
      if (!run) return rmSync(this.file, { force: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(run))
      renameOver(tmp, this.file)
    } catch {}
  }

  /** Ends the running app and waits until its process has exited. */
  async stop(): Promise<void> {
    const run = this.current
    // An explicit stop (or another mission's app replacing it): don't bring it back.
    this.persist(null)
    if (!run || !this.terminals.isRunning(run.terminalId)) return
    const pid = this.terminals.pid(run.terminalId)
    if (pid) this.killTree(pid)
    this.terminals.kill(run.terminalId)
    for (const end = Date.now() + this.exitWaitMs; this.terminals.isRunning(run.terminalId); await new Promise((r) => setTimeout(r, 100))) {
      if (Date.now() > end) throw new Error(`${run.missionName}'s app has not exited yet. Try again in a few seconds.`)
    }
  }

  /** Stops the app if it belongs to this mission (before its worktree is removed). */
  async stopFor(missionId: string): Promise<void> {
    if (this.current?.missionId === missionId) await this.stop()
  }

  terminalExited(terminalId: string, exitCode: number): void {
    if (this.current?.terminalId !== terminalId) return
    this.current = { ...this.current, status: 'exited', exitCode }
    this.changed(this.current)
  }

  /** Quit: end the app without waiting. */
  shutdown(): void {
    const run = this.current
    if (!run) return
    const pid = this.terminals.pid(run.terminalId)
    if (pid) this.killTree(pid)
    this.terminals.kill(run.terminalId)
  }
}
