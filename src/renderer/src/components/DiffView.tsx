import { useMemo, useState } from 'react'
import { FileDiff } from 'lucide-react'
import type { DiffView as Diff } from '../../../shared/types'
import { cn } from '../lib/utils'

/** Read-only diff: a file list and the unified patch, one file at a time or all. */
export function DiffView({ diff }: { diff: Diff }): React.JSX.Element {
  const [file, setFile] = useState<string | null>(null)
  const sections = useMemo(() => {
    const out: { path: string; text: string }[] = []
    for (const chunk of diff.patch.split(/^(?=diff --git )/m)) {
      const m = /^diff --git a\/(.+?) b\//.exec(chunk)
      if (m) out.push({ path: m[1], text: chunk })
    }
    return out
  }, [diff.patch])
  const shown = file ? sections.filter((s) => s.path === file) : sections

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border" data-testid="diff">
      <div className="w-56 shrink-0 overflow-y-auto border-r bg-panel py-1">
        <button className={cn('flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-1 text-left text-[12px] hover:bg-accent', !file && 'bg-accent')} onClick={() => setFile(null)}>
          <FileDiff className="size-3.5" /> All files <span className="ml-auto text-muted-foreground">{diff.files.length}</span>
        </button>
        {diff.files.map((f) => (
          <button key={f.path} data-testid="diff-file" className={cn('flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-1 text-left font-mono text-[11.5px] hover:bg-accent', file === f.path && 'bg-accent')} onClick={() => setFile(f.path)}>
            <span className="truncate">{f.path}</span>
            <span className="ml-auto shrink-0 tabular-nums text-working">+{f.added}</span>
            <span className="shrink-0 tabular-nums text-destructive">-{f.removed}</span>
          </button>
        ))}
      </div>
      <pre className="m-0 min-w-0 flex-1 overflow-auto bg-background p-3 font-mono text-[12px] leading-[1.45]">
        {shown.length === 0 && <span className="text-muted-foreground">No changes.</span>}
        {shown.map((s) =>
          s.text.split('\n').map((line, i) => (
            <div
              key={`${s.path}:${i}`}
              className={cn(
                'whitespace-pre',
                line.startsWith('+') && !line.startsWith('+++') && 'bg-working/10 text-working',
                line.startsWith('-') && !line.startsWith('---') && 'bg-destructive/10 text-destructive',
                line.startsWith('@@') && 'text-done',
                (line.startsWith('diff --git') || line.startsWith('index ')) && 'mt-2 font-semibold text-foreground'
              )}
            >
              {line || ' '}
            </div>
          ))
        )}
      </pre>
    </div>
  )
}
