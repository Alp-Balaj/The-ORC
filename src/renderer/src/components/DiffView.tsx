import { useMemo, useState } from 'react'
import { FileDiff } from 'lucide-react'
import type { DiffView as Diff } from '../../../shared/types'
import { cn } from '../lib/utils'

type Row =
  | { kind: 'hunk'; text: string }
  | { kind: 'ctx' | 'add' | 'del'; text: string; old: number | null; new: number | null }
  | { kind: 'note'; text: string }

interface Section {
  path: string
  newPath: string
  label: 'new' | 'deleted' | 'renamed' | null
  rows: Row[]
  added: number
  removed: number
}

const META = /^(diff --git |index |--- |\+\+\+ |new file mode|deleted file mode|old mode|new mode|similarity|dissimilarity|rename from|rename to|copy from|copy to)/

function parse(patch: string): Section[] {
  const out: Section[] = []
  for (const chunk of patch.split(/^(?=diff --git )/m)) {
    const m = /^diff --git a\/(.+?) b\/(.+)$/m.exec(chunk)
    if (!m) continue
    const s: Section = { path: m[1], newPath: m[2], label: null, rows: [], added: 0, removed: 0 }
    let o = 0
    let n = 0
    let inHunk = false
    const lines = chunk.split('\n')
    if (lines[lines.length - 1] === '') lines.pop()
    for (const line of lines) {
      if (!inHunk || line.startsWith('diff --git ')) {
        if (line.startsWith('new file mode')) s.label = 'new'
        else if (line.startsWith('deleted file mode')) s.label = 'deleted'
        else if (line.startsWith('rename from') || line.startsWith('similarity')) s.label = 'renamed'
        if (line.startsWith('Binary files')) { s.rows.push({ kind: 'note', text: 'Binary file changed' }); continue }
        if (META.test(line)) continue
      }
      const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      if (h) {
        o = Number(h[1])
        n = Number(h[2])
        inHunk = true
        s.rows.push({ kind: 'hunk', text: line })
      } else if (!inHunk) {
        if (line.trim()) s.rows.push({ kind: 'note', text: line })
      } else if (line.startsWith('+')) {
        s.rows.push({ kind: 'add', text: line.slice(1), old: null, new: n++ })
        s.added++
      } else if (line.startsWith('-')) {
        s.rows.push({ kind: 'del', text: line.slice(1), old: o++, new: null })
        s.removed++
      } else if (line.startsWith('\\')) {
        s.rows.push({ kind: 'note', text: line })
      } else {
        s.rows.push({ kind: 'ctx', text: line.slice(1), old: o++, new: n++ })
      }
    }
    out.push(s)
  }
  return out
}

function splitPath(p: string): [string, string] {
  const i = p.lastIndexOf('/')
  return i < 0 ? ['', p] : [p.slice(0, i + 1), p.slice(i + 1)]
}

const gutter = 'w-8 shrink-0 select-none pr-1.5 text-right tabular-nums text-muted-foreground/60'

/** Read-only diff: a file list and the unified patch, one file at a time or all. */
export function DiffView({ diff }: { diff: Diff }): React.JSX.Element {
  const [file, setFile] = useState<string | null>(null)
  const sections = useMemo(() => parse(diff.patch), [diff.patch])
  const stats = useMemo(() => new Map(diff.files.map((f) => [f.path, f])), [diff.files])
  const shown = file ? sections.filter((s) => s.path === file || s.newPath === file) : sections

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border" data-testid="diff">
      <div className="hidden min-[1600px]:flex w-52 shrink-0 flex-col overflow-y-auto border-r bg-panel pb-1">
        <div className="flex items-center px-3 pt-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Files <span className="ml-auto tabular-nums normal-case">{diff.files.length}</span>
        </div>
        <button
          className={cn('mx-1 flex cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-[12px] hover:bg-accent', !file && 'bg-accent shadow-[inset_2px_0_0] shadow-primary')}
          onClick={() => setFile(null)}
        >
          <FileDiff className="size-3.5 text-muted-foreground" /> All files
        </button>
        {diff.files.map((f) => {
          const [dir, name] = splitPath(f.path)
          return (
            <button
              key={f.path}
              data-testid="diff-file"
              title={f.path}
              className={cn('mx-1 flex min-w-0 cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left font-mono text-[11.5px] hover:bg-accent', file === f.path && 'bg-accent shadow-[inset_2px_0_0] shadow-primary')}
              onClick={() => setFile(f.path)}
            >
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-foreground">{name}</span>
                {dir && <span className="truncate text-[10.5px] text-muted-foreground">{dir}</span>}
              </span>
              <span className="shrink-0 text-[10.5px] tabular-nums text-working">+{f.added}</span>
              <span className="shrink-0 text-[10.5px] tabular-nums text-destructive">−{f.removed}</span>
            </button>
          )
        })}
      </div>
      <div className="flex min-w-0 flex-1 flex-col bg-background">
      <div className="border-b bg-panel px-2 py-1.5 text-[12px] min-[1600px]:hidden">
        <select
          className="max-w-full truncate rounded-md border border-input bg-background px-2 py-1 font-mono text-[12px]"
          value={file ?? ''}
          onChange={(e) => setFile(e.target.value || null)}
        >
          <option value="">All files ({diff.files.length})</option>
          {diff.files.map((f) => (
            <option key={f.path} value={f.path}>{`${f.path}  +${f.added} −${f.removed}`}</option>
          ))}
        </select>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {shown.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">No changes.</div>
        ) : (
          <div className="flex w-max min-w-full flex-col gap-3 p-2 min-[1600px]:p-3 font-mono text-[12px] leading-[1.5]">
            {shown.map((s) => {
              const st = stats.get(s.path) ?? stats.get(s.newPath)
              const [dir, name] = splitPath(s.newPath)
              return (
                <div key={s.path} className="rounded-md border">
                  <div className="sticky top-0 z-10 flex items-center gap-2 rounded-t-md border-b bg-card px-3 py-1.5">
                    <span className="whitespace-pre">
                      {s.label === 'renamed' && <span className="text-muted-foreground">{s.path} → </span>}
                      <span className="text-muted-foreground">{dir}</span>
                      <span className="text-foreground">{name}</span>
                    </span>
                    {s.label && <span className="rounded-sm border px-1.5 text-[10.5px] text-muted-foreground">{s.label}</span>}
                    <span className="ml-auto pl-4 tabular-nums text-working">+{st?.added ?? s.added}</span>
                    <span className="tabular-nums text-destructive">−{st?.removed ?? s.removed}</span>
                  </div>
                  <div className="overflow-hidden rounded-b-md">
                    {s.rows.map((r, i) =>
                      r.kind === 'hunk' ? (
                        <div key={i} className="whitespace-pre bg-done/5 px-3 py-0.5 text-[11px] text-done/80">{r.text}</div>
                      ) : r.kind === 'note' ? (
                        <div key={i} className="whitespace-pre px-3 py-1 text-muted-foreground">{r.text}</div>
                      ) : (
                        <div key={i} className={cn('flex', r.kind === 'add' && 'bg-working/10', r.kind === 'del' && 'bg-destructive/10')}>
                          <span className={cn(gutter, r.kind === 'add' && 'bg-working/15', r.kind === 'del' && 'bg-destructive/15')}>{r.old ?? ''}</span>
                          <span className={cn(gutter, r.kind === 'add' && 'bg-working/15', r.kind === 'del' && 'bg-destructive/15')}>{r.new ?? ''}</span>
                          <span className={cn('w-5 shrink-0 select-none text-center', r.kind === 'add' && 'text-working', r.kind === 'del' && 'text-destructive')}>
                            {r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ''}
                          </span>
                          <span className="whitespace-pre pr-4">{r.text || ' '}</span>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      </div>
    </div>
  )
}
