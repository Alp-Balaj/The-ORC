import { open, readdir } from 'node:fs/promises'

export interface Usage {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

export interface TokenCount {
  /** input + cache writes + output, over every assistant message. */
  tokens: number
  /** input + cache writes + cache reads of the latest message: the context in use. */
  contextTokens: number
  /** Cost-weighted total (see COST_WEIGHTS), cache reads included. */
  weighted: number
}

/** Relative price per token, input = 1. Cache reads count here but not in `tokens`. */
export const COST_WEIGHTS = { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 }

/** Incremental reader of one JSONL file. Lines are fed to `sink`; the parent owns dedup. */
class FileReader {
  private offset = 0
  private partial = ''
  private lineNo = 0 // 0-based index of the next complete line; blank lines count too.
  readonly path: string
  private readonly sink: (usage: Usage, id: string | undefined, main: boolean) => void
  private readonly main: boolean
  private readonly onReset: () => void

  constructor(path: string, main: boolean, sink: FileReader['sink'], onReset: () => void) {
    this.path = path
    this.main = main
    this.sink = sink
    this.onReset = onReset
  }

  async update(): Promise<void> {
    let fh
    try {
      fh = await open(this.path, 'r')
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code !== 'ENOENT') console.error('tokens: could not open transcript', this.path, code)
      return
    }
    try {
      const { size } = await fh.stat()
      if (size < this.offset) {
        this.offset = 0
        this.partial = ''
        this.lineNo = 0
        this.onReset()
      }
      if (size > this.offset) {
        const buf = Buffer.alloc(size - this.offset)
        const { bytesRead } = await fh.read(buf, 0, buf.length, this.offset)
        this.offset += bytesRead
        this.ingest(buf.toString('utf8', 0, bytesRead))
      }
    } finally {
      await fh.close()
    }
  }

  ingest(text: string): void {
    const lines = (this.partial + text).split('\n')
    this.partial = lines.pop() ?? ''
    for (const line of lines) {
      const index = this.lineNo++
      if (!line.trim()) continue
      let entry: { message?: { id?: string; usage?: Usage } } | null
      try {
        entry = JSON.parse(line) as { message?: { id?: string; usage?: Usage } } | null
      } catch {
        console.error('tokens: skipped unparseable transcript line', this.path, index, Buffer.byteLength(line))
        continue
      }
      const usage = entry?.message?.usage
      if (!usage) continue
      this.sink(usage, entry?.message?.id, this.main)
    }
  }
}

/** Sums `usage` over a Claude Code session: the main transcript plus the subagent (Agent tool)
 *  transcripts. Verified against real transcripts: subagent messages (isSidechain:true) are NOT in
 *  the main file; they live in `<session-id>/subagents/agent-<id>.jsonl` next to it. Streaming writes
 *  several lines per assistant message with the same `message.id`; the last one wins, across files.
 *  `contextTokens` comes from the main transcript only (the subagents have their own contexts). */
export class TranscriptTally {
  private readonly byMessage = new Map<string, Usage>()
  private latest: Usage | null = null
  private anon = 0
  private readonly main: FileReader
  private readonly subs = new Map<string, FileReader>()
  private readonly subDir: string
  readonly path: string

  constructor(path: string) {
    this.path = path
    this.subDir = path.replace(/\.jsonl$/, '') + '/subagents'
    this.main = this.makeReader(path, true)
  }

  private makeReader(path: string, main: boolean): FileReader {
    return new FileReader(
      path,
      main,
      (usage, id, isMain) => {
        // Reading a reset file again re-adds under the same ids; anonymous lines are keyed per file.
        this.byMessage.set(id ?? `anon-${path}-${this.anon++}`, usage)
        if (isMain) this.latest = usage
      },
      // A truncated file is re-read from 0; drop everything and let all files re-ingest.
      () => this.resetAll()
    )
  }

  private resetAll(): void {
    this.byMessage.clear()
    this.latest = null
    this.anon = 0
    // Other files keep their offsets, so force them to re-read from the start.
    this.subs.clear()
  }

  /** Reads whatever was appended since the last call. Missing file = nothing yet. */
  async update(): Promise<TokenCount> {
    await this.main.update()
    let names: string[] = []
    try {
      names = await readdir(this.subDir)
    } catch {
      // No subagents (yet).
    }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue
      let r = this.subs.get(name)
      if (!r) {
        r = this.makeReader(`${this.subDir}/${name}`, false)
        this.subs.set(name, r)
      }
      try {
        await r.update()
      } catch (err) {
        console.error('tokens: subagent transcript failed', name, (err as Error)?.message)
      }
    }
    return this.count()
  }

  /** Test/compat hook: feeds text to the main transcript. */
  ingest(text: string): void {
    this.main.ingest(text)
  }

  count(): TokenCount {
    let tokens = 0
    let weighted = 0
    const w = COST_WEIGHTS
    for (const u of this.byMessage.values()) {
      const i = u.input_tokens ?? 0
      const cw = u.cache_creation_input_tokens ?? 0
      const o = u.output_tokens ?? 0
      tokens += i + cw + o
      weighted += i * w.input + cw * w.cacheWrite + o * w.output + (u.cache_read_input_tokens ?? 0) * w.cacheRead
    }
    const l = this.latest
    const contextTokens = l
      ? (l.input_tokens ?? 0) + (l.cache_creation_input_tokens ?? 0) + (l.cache_read_input_tokens ?? 0)
      : 0
    return { tokens, contextTokens, weighted }
  }
}
