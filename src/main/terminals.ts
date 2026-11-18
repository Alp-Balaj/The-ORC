import * as pty from 'node-pty'

export type TerminalId = string

export interface TerminalSpec {
  id: TerminalId
  command: string
  args: string[]
  cwd: string
  /** The full environment. Defaults to this process's own. */
  env?: Record<string, string>
}

type DataListener = (id: TerminalId, data: string) => void
type ExitListener = (id: TerminalId, exitCode: number) => void

/** Owns every live pseudo-terminal. Output is buffered so a renderer that
 *  switches to a terminal late can replay what it missed. */
export class TerminalHost {
  private readonly terminals = new Map<TerminalId, pty.IPty>()
  private readonly scrollback = new Map<TerminalId, string>()
  private static readonly MaxScrollback = 512 * 1024

  private readonly onData: DataListener
  private readonly onExit: ExitListener
  private readonly taps = new Set<DataListener>()

  constructor(onData: DataListener, onExit: ExitListener) {
    this.onData = onData
    this.onExit = onExit
  }

  start(spec: TerminalSpec, cols = 120, rows = 32): void {
    if (this.terminals.has(spec.id)) throw new Error(`terminal ${spec.id} already running`)
    const term = pty.spawn(spec.command, spec.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: spec.cwd,
      env: spec.env ?? (process.env as Record<string, string>)
    })
    this.terminals.set(spec.id, term)
    this.scrollback.set(spec.id, '')
    term.onData((data) => {
      const prev = this.scrollback.get(spec.id) ?? ''
      const next = prev + data
      this.scrollback.set(
        spec.id,
        next.length > TerminalHost.MaxScrollback ? next.slice(-TerminalHost.MaxScrollback) : next
      )
      this.onData(spec.id, data)
      for (const tap of this.taps) tap(spec.id, data)
    })
    term.onExit(({ exitCode }) => {
      this.terminals.delete(spec.id)
      this.onExit(spec.id, exitCode)
    })
  }

  /** Extra output listener (the smoke test uses it). Returns an unsubscribe. */
  tap(listener: DataListener): () => void {
    this.taps.add(listener)
    return () => this.taps.delete(listener)
  }

  write(id: TerminalId, data: string): void {
    this.terminals.get(id)?.write(data)
  }

  resize(id: TerminalId, cols: number, rows: number): void {
    this.terminals.get(id)?.resize(cols, rows)
  }

  replay(id: TerminalId): string {
    return this.scrollback.get(id) ?? ''
  }

  /** PIDs of every live terminal's process, so a test can prove none survive. */
  pids(): Record<TerminalId, number> {
    return Object.fromEntries([...this.terminals].map(([id, t]) => [id, t.pid]))
  }

  isRunning(id: TerminalId): boolean {
    return this.terminals.has(id)
  }

  killAll(): void {
    for (const term of this.terminals.values()) term.kill()
    this.terminals.clear()
  }
}
