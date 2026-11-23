import { dialogPanel } from './ui/dialog'
import { useEffect, useState } from 'react'
import { SquareTerminal, X } from 'lucide-react'
import { SHORTCUTS, type ShortcutGroup } from '../lib/shortcuts'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Kbd } from './ui/kbd'

const GROUPS: ShortcutGroup[] = ['Missions', 'Agents', 'View', 'General']

/** The keyboard shortcuts cheat sheet. */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  const [query, setQuery] = useState('')
  useEffect(() => {
    if (open) setQuery('')
  }, [open])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null

  const q = query.trim().toLowerCase()
  const groups = GROUPS.map((g) => ({
    group: g,
    items: SHORTCUTS.filter((s) => s.group === g && (!q || s.label.toLowerCase().includes(q) || g.toLowerCase().includes(q)))
  })).filter((g) => g.items.length > 0)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        data-testid="shortcuts-dialog"
        className={dialogPanel("lg")}
      >
        <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
          <h2 className="text-[14px] font-semibold">Keyboard shortcuts</h2>
          <Button variant="ghost" size="icon" onClick={onClose} title="Close (Esc)" aria-label="Close">
            <X />
          </Button>
        </div>
        <div className="px-4 pb-3">
          <Input
            autoFocus
            placeholder="Filter shortcuts"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                if (query) setQuery('')
                else onClose()
              } else if (e.key === 'Enter' || e.key.startsWith('Arrow')) e.stopPropagation()
            }}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto border-t px-4 py-3">
          {groups.length === 0 ? (
            <div className="py-6 text-center text-[13px] text-muted-foreground">No shortcut matches “{query.trim()}”</div>
          ) : (
            <div className="gap-x-8 sm:columns-2">
              {groups.map(({ group, items }) => (
                <section key={group} className="mb-4 break-inside-avoid">
                  <h3 className="mb-1.5 section-title">{group}</h3>
                  <ul>
                    {items.map((s) => (
                      <li key={s.id} className="flex min-h-7 items-center justify-between gap-3 text-[12.5px]">
                        <span className="flex min-w-0 items-center gap-1.5 text-foreground">
                          {s.label}
                          {s.bindings.some((b) => b.scope === 'global') && (
                            <SquareTerminal className="size-3 shrink-0 text-faint" aria-label="Works in the terminal" />
                          )}
                        </span>
                        <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                          {s.bindings.map((b, i) => (
                            <span key={b.keys} className="flex items-center gap-1">
                              {i > 0 && <span className="text-[11px] text-faint">or</span>}
                              <Kbd keys={b.keys} />
                            </span>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 border-t px-4 py-2.5 text-[11.5px] text-faint">
          <SquareTerminal className="size-3 shrink-0" />
          <span>Marked shortcuts work while typing to an agent; Ctrl+C, Ctrl+R and other terminal keys still go to the session.</span>
        </div>
      </div>
    </div>
  )
}
