import * as pty from 'node-pty'
import { statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

export type TerminalId = string

export interface TerminalSpec {
  id: TerminalId
  command: string
  args: string[]
  cwd: string
  /** The full environment. Defaults to this process's own. */
  env?: Record<string, string>
}

/** On Windows, node-pty (ConPTY) needs the program's real file: unlike CreateProcess it neither
 *  appends .exe nor searches PATH for `claude`. So find it on PATH with PATHEXT here. Other
 *  platforms (and paths that are already a file) pass through unchanged. */
export function resolveCommand(command: string, env: Record<string, string | undefined>): string {
  if (process.platform !== 'win32' || isAbsolute(command) || /[\\/]/.test(command)) return command
  const get = (name: string): string =>
    Object.entries(env).find(([k]) => k.toUpperCase() === name)?.[1] ?? ''
  const exts = ['', ...(get('PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)]
  for (const dir of get('PATH').split(';').filter(Boolean)) {
    for (const ext of exts) {
      const candidate = join(dir, command + ext)
      try {
        if (ext !== '' || /\.[^\\/.]+$/.test(command)) if (statSync(candidate).isFile()) return candidate
      } catch (err) {
        // A missing candidate is expected (most PATH/PATHEXT combinations don't exist): skip silently.
        // Anything else (EACCES, EPERM, ...) is logged; the candidate is still just skipped.
        const code = (err as NodeJS.ErrnoException)?.code
        if (code !== 'ENOENT' && code !== 'ENOTDIR') console.error(`terminals: could not stat ${candidate} while resolving ${command}; skipping it:`, err)
      }
    }
  }
  return command
}

type DataListener =(id: TerminalId, data: string) => void
type ExitListener = (id: TerminalId, exitCode: number) => void

/** Owns every live pseudo-terminal. Output is buffered so a renderer that
 *  switches to a terminal late can replay what it missed. */
export class TerminalHost {
  private readonly terminals = new Map<TerminalId, pty.IPty>()
  /** Output chunks, newest last, with their total length: appending is O(1) per chunk instead of
   *  copying the whole (up to 512 KB) buffer on every pty read. */
  private readonly scrollback = new Map<TerminalId, { chunks: string[]; size: number }>()
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
    const env = spec.env ?? (process.env as Record<string, string>)
    const term = pty.spawn(resolveCommand(spec.command, env), spec.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: spec.cwd,
      env
    })
    this.terminals.set(spec.id, term)
    const buf = { chunks: [] as string[], size: 0 }
    this.scrollback.set(spec.id, buf)
    term.onData((data) => {
      buf.chunks.push(data)
      buf.size += data.length
      // Drop the oldest output until the buffer is back within the cap (cutting into a chunk
      // when needed), keeping the same tail a plain slice(-cap) would keep.
      while (buf.size > TerminalHost.MaxScrollback) {
        const over = buf.size - TerminalHost.MaxScrollback
        const first = buf.chunks[0]
        if (first.length <= over) {
          buf.chunks.shift()
          buf.size -= first.length
        } else {
          buf.chunks[0] = first.slice(over)
          buf.size -= over
        }
      }
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
    return this.scrollback.get(id)?.chunks.join('') ?? ''
  }

  /** PIDs of every live terminal's process, so a test can prove none survive. */
  pids(): Record<TerminalId, number> {
    return Object.fromEntries([...this.terminals].map(([id, t]) => [id, t.pid]))
  }

  pid(id: TerminalId): number | null {
    return this.terminals.get(id)?.pid ?? null
  }

  isRunning(id: TerminalId): boolean {
    return this.terminals.has(id)
  }

  kill(id: TerminalId): void {
    this.terminals.get(id)?.kill()
  }

  killAll(): void {
    for (const term of this.terminals.values()) term.kill()
    this.terminals.clear()
  }
}
