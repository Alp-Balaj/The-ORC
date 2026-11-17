import * as pty from 'node-pty'

export type TerminalId = string

export interface TerminalSpec {
  id: TerminalId
  command: string
  args: string[]
  cwd: string
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
      env: { ...process.env, ...spec.env } as Record<string, string>
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
    })
    term.onExit(({ exitCode }) => {
      this.terminals.delete(spec.id)
      this.onExit(spec.id, exitCode)
    })
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

  isRunning(id: TerminalId): boolean {
    return this.terminals.has(id)
  }

  killAll(): void {
    for (const term of this.terminals.values()) term.kill()
    this.terminals.clear()
  }
}
