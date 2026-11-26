import { open } from 'node:fs/promises'

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
}

/** Reads a Claude Code transcript (JSONL) incrementally and sums `usage`. Streaming writes
 *  several lines per assistant message with the same `message.id`; the last one wins. */
export class TranscriptTally {
  private offset = 0
  private partial = ''
  private readonly byMessage = new Map<string, Usage>()
  private latest: Usage | null = null
  /** 0-based index of the next complete line in the file; blank lines count too. */
  private lineNo = 0
  readonly path: string

  constructor(path: string) {
    this.path = path
  }

  /** Reads whatever was appended since the last call. Missing file = nothing yet. */
  async update(): Promise<TokenCount> {
    let fh
    try {
      fh = await open(this.path, 'r')
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code !== 'ENOENT') console.error('tokens: could not open transcript', this.path, code)
      return this.count()
    }
    try {
      const { size } = await fh.stat()
      if (size < this.offset) this.reset()
      if (size > this.offset) {
        const buf = Buffer.alloc(size - this.offset)
        await fh.read(buf, 0, buf.length, this.offset)
        this.offset = size
        this.ingest(buf.toString('utf8'))
      }
    } finally {
      await fh.close()
    }
    return this.count()
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
      this.byMessage.set(entry?.message?.id ?? `line-${this.byMessage.size}`, usage)
      this.latest = usage
    }
  }

  count(): TokenCount {
    let tokens = 0
    for (const u of this.byMessage.values()) {
      tokens += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0)
    }
    const l = this.latest
    const contextTokens = l
      ? (l.input_tokens ?? 0) + (l.cache_creation_input_tokens ?? 0) + (l.cache_read_input_tokens ?? 0)
      : 0
    return { tokens, contextTokens }
  }

  private reset(): void {
    this.offset = 0
    this.partial = ''
    this.lineNo = 0
    this.byMessage.clear()
    this.latest = null
  }
}
