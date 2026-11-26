import { mkdirSync, readFileSync, readdirSync, statSync, type Dirent, type Stats } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** Local, offline lexical search over a repo's history: the space's mission records and the
 *  repo's docs/**\/*.md (code is not indexed). SQLite FTS5 with bm25 ranking, kept fresh by
 *  re-reading only files whose mtime or size changed since the last search. One db file can hold
 *  several repos: rows are keyed by absolute path and each search filters to its own folders. */

export interface HistorySearchOptions {
  recordsDir: string | null
  repoRoot: string
  query: string
  limit?: number
}

interface Chunk {
  heading: string
  body: string
  label: string
  date: string
}

const RECORD_FILE = /^(\d{4}-\d{2}-\d{2}) - (.+)\.md$/
/** Recency boost for records (docs keep plain bm25): score = -bm25 * (1 + RECORD_BOOST) * decay,
 *  decay = DECAY_FLOOR + (1 - DECAY_FLOOR) * 0.5^(ageDays / HALF_LIFE_DAYS). */
const RECORD_BOOST = 0.4
const DECAY_FLOOR = 0.7
const HALF_LIFE_DAYS = 14
const DAY_MS = 86_400_000
const SPLIT_AT = 4000
const PIECE = 2000

export class HistoryIndex {
  private dbPath: string
  private db: DatabaseSync | null = null
  /** Files (re)indexed by the last search: for checks, not part of the contract. */
  lastIndexed = 0

  constructor(dbPath: string) {
    this.dbPath = dbPath
  }

  private open(): DatabaseSync {
    if (this.db) return this.db
    if (this.dbPath !== ':memory:') mkdirSync(dirname(this.dbPath), { recursive: true })
    const db = new DatabaseSync(this.dbPath)
    db.exec(`
      CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, mtime REAL NOT NULL, size INTEGER NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(
        heading, body, path UNINDEXED, kind UNINDEXED, label UNINDEXED, date UNINDEXED,
        tokenize = 'porter unicode61'
      );
    `)
    this.db = db
    return db
  }

  search(o: HistorySearchOptions): string {
    try {
      const terms = queryTerms(o.query)
      if (terms.length === 0)
        return 'Usage: give a few words to search the mission records and docs/ for, e.g. "verifier gate" or "merge conflict".'
      const limit = Math.max(1, Math.min(25, Math.floor(o.limit ?? 8) || 8))
      const db = this.open()
      const repoRoot = resolve(o.repoRoot)
      const recordsDir = o.recordsDir ? resolve(o.recordsDir) : null
      const prefixes = [join(repoRoot, 'docs') + sep]
      if (recordsDir) prefixes.unshift(recordsDir + sep)
      this.refresh(db, recordsDir, repoRoot, prefixes)

      const where = prefixes.map(() => 'substr(path, 1, ?) = ?').join(' OR ')
      const args = prefixes.flatMap((p) => [p.length, p])
      const candidates = db
        .prepare(
          `SELECT kind, label, date, path, snippet(chunks, 1, '', '', '…', 24) AS snip,
                  bm25(chunks, 4.0, 1.0, 0, 0, 0, 0) AS rank
           FROM chunks WHERE chunks MATCH ? AND (${where})
           ORDER BY rank LIMIT ?`
        )
        .all(terms.map((t) => `"${t}"`).join(' OR '), ...args, Math.max(50, limit * 4)) as unknown as {
        kind: string
        label: string
        date: string
        path: string
        snip: string
        rank: number
      }[]
      const now = Date.now()
      const rows = candidates
        .map((r) => ({ r, score: -r.rank * (r.kind === 'record' ? recencyFactor(r.date, now) : 1) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((x) => x.r)

      const scope = recordsDir ? 'records + docs' : 'docs only, no records folder'
      const q = o.query.trim().replace(/\s+/g, ' ')
      if (rows.length === 0)
        return `No results for "${q}" (${scope}; code is not indexed — use CodeGraph for code). Try other or fewer words, a synonym, or a lead/mission name.`
      const out = [`${rows.length} result${rows.length === 1 ? '' : 's'} for "${q}" (${scope}; code is not indexed — use CodeGraph for code):`]
      rows.forEach((r, i) => {
        const snip = r.snip.replace(/\s+/g, ' ').trim()
        if (r.kind === 'record') {
          out.push(`${i + 1}. [record] ${r.label}`, `   ${basename(r.path)}`)
        } else {
          out.push(`${i + 1}. [doc] ${r.label} · ${r.date}`)
        }
        out.push(`   ${snip}`)
      })
      out.push('Read a section in full only if the snippet is not enough (Read the file, or grep the heading).')
      return out.join('\n')
    } catch (e) {
      return `History search failed: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  close(): void {
    try {
      this.db?.close()
    } catch {
      /* already closed */
    }
    this.db = null
  }

  /** Reindex changed files, drop rows for files that disappeared. */
  private refresh(db: DatabaseSync, recordsDir: string | null, repoRoot: string, prefixes: string[]): void {
    const current = new Map<string, { mtime: number; size: number; kind: 'record' | 'doc' }>()
    if (recordsDir) {
      for (const f of safeReaddir(recordsDir)) {
        if (!RECORD_FILE.test(f)) continue
        const p = join(recordsDir, f)
        const st = safeStat(p)
        if (st?.isFile()) current.set(p, { mtime: st.mtimeMs, size: st.size, kind: 'record' })
      }
    }
    for (const p of walkMd(join(repoRoot, 'docs'))) {
      const st = safeStat(p)
      if (st?.isFile()) current.set(p, { mtime: st.mtimeMs, size: st.size, kind: 'doc' })
    }

    const where = prefixes.map(() => 'substr(path, 1, ?) = ?').join(' OR ')
    const known = db
      .prepare(`SELECT path, mtime, size FROM files WHERE ${where}`)
      .all(...prefixes.flatMap((p) => [p.length, p])) as unknown as { path: string; mtime: number; size: number }[]
    const knownMap = new Map(known.map((k) => [k.path, k]))

    const delChunks = db.prepare('DELETE FROM chunks WHERE path = ?')
    const delFile = db.prepare('DELETE FROM files WHERE path = ?')
    const insChunk = db.prepare('INSERT INTO chunks (heading, body, path, kind, label, date) VALUES (?, ?, ?, ?, ?, ?)')
    const upFile = db.prepare('INSERT OR REPLACE INTO files (path, mtime, size) VALUES (?, ?, ?)')

    let changed = 0
    db.exec('BEGIN')
    try {
      for (const k of known) {
        if (!current.has(k.path)) {
          delChunks.run(k.path)
          delFile.run(k.path)
        }
      }
      for (const [p, f] of current) {
        const k = knownMap.get(p)
        if (k && k.mtime === f.mtime && k.size === f.size) continue
        let text: string
        try {
          text = readFileSync(p, 'utf8')
        } catch (e) {
          // Unreadable file: skip it, but leave a trace so it does not vanish from search silently.
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
            console.error(`history-index: skipped ${p}: ${e instanceof Error ? e.message : String(e)}`)
          continue
        }
        changed++
        delChunks.run(p)
        const chunks =
          f.kind === 'record'
            ? recordChunks(basename(p), text)
            : docChunks(relative(repoRoot, p).split(sep).join('/'), text, new Date(f.mtime).toISOString().slice(0, 10))
        for (const c of chunks) insChunk.run(c.heading, c.body, p, f.kind, c.label, c.date)
        upFile.run(p, f.mtime, f.size)
      }
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    this.lastIndexed = changed
  }
}

/** Multiplier for a record section dated `date` ("YYYY-MM-DD[ HH:MM]", local time). */
function recencyFactor(date: string, now: number): number {
  const t = new Date(date.length > 10 ? date.replace(' ', 'T') : `${date}T00:00`).getTime()
  const ageDays = Number.isFinite(t) ? Math.max(0, (now - t) / DAY_MS) : Infinity
  const decay = DECAY_FLOOR + (1 - DECAY_FLOOR) * 0.5 ** (ageDays / HALF_LIFE_DAYS)
  return (1 + RECORD_BOOST) * decay
}

/** Free text → safe FTS5 terms: words only (FTS syntax characters dropped), deduped, capped. */
function queryTerms(query: string): string[] {
  const words = (query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).filter((w) => w.length > 1 || /\d/.test(w))
  return [...new Set(words)].slice(0, 16)
}

/** One chunk per `## Heading (YYYY-MM-DD HH:MM)` section appended by appendRecord. */
function recordChunks(file: string, text: string): Chunk[] {
  const m = RECORD_FILE.exec(file)
  const fileDate = m?.[1] ?? ''
  const mission = m?.[2] ?? file
  const lines = text.replace(/^---\n[\s\S]*?\n---\n/, '').split('\n')
  const stamped = /^## (.+?) \((\d{4}-\d{2}-\d{2} \d{2}:\d{2})\)\s*$/
  const anyH2 = /^## (.+?)\s*$/
  const isHead = lines.some((l) => stamped.test(l)) ? stamped : anyH2
  const out: Chunk[] = []
  let cur: { heading: string; date: string; body: string[] } | null = null
  const flush = (): void => {
    if (!cur) return
    const body = cleanRecordBody(cur.body.join('\n'))
    const label = `${mission} · ${cur.date} · "${cur.heading}"`
    for (const piece of splitLong(body)) out.push({ heading: cur.heading, body: piece, label, date: cur.date })
  }
  for (const line of lines) {
    const h = isHead.exec(line)
    if (h) {
      flush()
      cur = { heading: h[1], date: h[2] ?? fileDate, body: [] }
    } else if (cur) cur.body.push(line)
  }
  flush()
  return out
}

function cleanRecordBody(s: string): string {
  return s
    .replace(/<\/?pasted_content\b[^>]*>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
}

/** One chunk per #/##/### section, labelled with its heading path; fenced code is not a heading. */
function docChunks(relPath: string, text: string, date: string): Chunk[] {
  const name = relPath
  const out: Chunk[] = []
  const path: string[] = ['', '', '']
  let body: string[] = []
  let fence = false
  const flush = (): void => {
    const b = body.join('\n').trim()
    body = []
    const heads = path.filter(Boolean)
    if (!b && heads.length === 0) return
    // The H1 is usually the doc title: drop it from the label once there's a deeper heading.
    const shown = path[1] || path[2] ? path.slice(1).filter(Boolean) : heads
    const label = [name, ...shown].join(' › ')
    for (const piece of splitLong(b)) out.push({ heading: heads.join(' › '), body: piece, label, date })
  }
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    const h = fence ? null : /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line)
    if (h) {
      flush()
      const level = h[1].length - 1
      path[level] = h[2]
      for (let i = level + 1; i < 3; i++) path[i] = ''
    } else body.push(line)
  }
  flush()
  return out
}

/** Sections over SPLIT_AT chars become paragraph-sized pieces of about PIECE chars. */
function splitLong(body: string): string[] {
  if (body.length <= SPLIT_AT) return [body]
  const pieces: string[] = []
  let cur = ''
  for (const para of body.split(/\n\s*\n/)) {
    if (cur && cur.length + para.length > PIECE) {
      pieces.push(cur)
      cur = ''
    }
    cur = cur ? `${cur}\n\n${para}` : para
  }
  if (cur) pieces.push(cur)
  return pieces
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function safeStat(p: string): Stats | null {
  try {
    return statSync(p)
  } catch {
    return null
  }
}

function walkMd(dir: string): string[] {
  const out: string[] = []
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walkMd(p))
    else if (e.isFile() && e.name.endsWith('.md')) out.push(p)
  }
  return out
}
