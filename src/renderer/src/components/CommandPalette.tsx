import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { shownAgents, type AgentStatus, type MissionView } from '../../../shared/types'
import { SHORTCUTS, emitShortcut, type ShortcutId } from '../lib/shortcuts'
import { cn } from '../lib/utils'
import { StatusDot } from './AgentCard'
import { Kbd } from './ui/kbd'

type Item =
  | { kind: 'mission'; key: string; id: string; title: string; detail: string; current: boolean }
  | { kind: 'agent'; key: string; terminalId: string; title: string; detail: string; status: AgentStatus }
  | { kind: 'command'; key: string; id: ShortcutId; title: string; keys: string }

const SECTION: Record<Item['kind'], string> = { mission: 'Missions', agent: 'Agents', command: 'Commands' }

function folderName(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p
}

/** Quick switcher: jump to any mission or agent, or run a command. */
export function CommandPalette({ open, onClose, missions, currentMissionId, onSelectMission, onSelectAgent }: {
  open: boolean
  onClose: () => void
  missions: MissionView[]
  currentMissionId: string | null
  onSelectMission: (id: string) => void
  onSelectAgent: (terminalId: string) => void
}): React.JSX.Element | null {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
    }
  }, [open])

  const items = useMemo<Item[]>(() => {
    const ms: Item[] = missions.map((m) => ({
      kind: 'mission', key: `m:${m.id}`, id: m.id, title: m.name, detail: folderName(m.repoPath), current: m.id === currentMissionId
    }))
    const ordered = [...missions].sort((a, b) => Number(b.id === currentMissionId) - Number(a.id === currentMissionId))
    const as: Item[] = ordered.flatMap((m) => shownAgents(m).map((a) => ({
      kind: 'agent' as const, key: `a:${a.terminalId}`, terminalId: a.terminalId, title: a.sessionName, detail: m.name, status: a.status
    })))
    const cs: Item[] = SHORTCUTS.filter((s) => !s.displayOnly && s.id !== 'palette' && s.id !== 'missionN' && s.bindings.length > 0)
      .map((s) => ({ kind: 'command', key: `c:${s.id}`, id: s.id, title: s.label, keys: s.bindings[0].keys }))
    const all = [...ms, ...as, ...cs]
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter((it) => `${it.title} ${'detail' in it ? it.detail : ''} ${SECTION[it.kind]}`.toLowerCase().includes(q))
  }, [missions, currentMissionId, query])

  const safeActive = items.length ? Math.min(active, items.length - 1) : 0

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${safeActive}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [safeActive, items])

  if (!open) return null

  function choose(it: Item): void {
    onClose()
    if (it.kind === 'mission') onSelectMission(it.id)
    else if (it.kind === 'agent') onSelectAgent(it.terminalId)
    else emitShortcut(it.id)
  }

  function onKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      if (!items.length) return
      const d = e.key === 'ArrowDown' ? 1 : -1
      setActive((safeActive + d + items.length) % items.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      const it = items[safeActive]
      if (it) choose(it)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 px-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Quick switcher"
        data-testid="command-palette"
        className="mt-[12vh] flex max-h-[70vh] w-full max-w-[560px] flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b px-3.5">
          <Search className="size-4 shrink-0 text-faint" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            placeholder="Jump to a mission, agent or command"
            className="h-11 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
          />
          <Kbd keys="Escape" />
        </div>
        <div ref={listRef} id="command-palette-list" role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {items.length === 0 ? (
            <div className="px-3 py-8 text-center text-[13px] text-muted-foreground">No match for “{query.trim()}”</div>
          ) : (
            items.map((it, i) => (
              <div key={it.key}>
                {(i === 0 || items[i - 1].kind !== it.kind) && (
                  <div className="px-2 pt-2 pb-1 section-title">{SECTION[it.kind]}</div>
                )}
                <div
                  role="option"
                  aria-selected={i === safeActive}
                  data-index={i}
                  onMouseMove={() => i !== safeActive && setActive(i)}
                  onClick={() => choose(it)}
                  className={cn(
                    'flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px]',
                    i === safeActive ? 'bg-selected text-foreground' : 'text-foreground/90 hover:bg-accent'
                  )}
                >
                  <span className="flex w-3.5 shrink-0 items-center justify-center">
                    {it.kind === 'agent' && <StatusDot status={it.status} />}
                  </span>
                  <span className="truncate">{it.title}</span>
                  {it.kind !== 'command' && <span className="truncate text-[12px] text-faint">{it.detail}</span>}
                  {it.kind === 'mission' && it.current && (
                    <span className="shrink-0 rounded bg-primary/15 px-1.5 text-[10.5px] leading-4 font-medium text-primary">current</span>
                  )}
                  <span className="ml-auto" />
                  {it.kind === 'command' && <Kbd keys={it.keys} />}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="flex items-center gap-3 border-t px-3.5 py-2 text-[11px] text-faint">
          <span className="flex items-center gap-1"><Kbd keys="ArrowUp" /><Kbd keys="ArrowDown" /> navigate</span>
          <span className="flex items-center gap-1"><Kbd keys="Enter" /> open</span>
          <span className="flex items-center gap-1"><Kbd keys="Escape" /> close</span>
        </div>
      </div>
    </div>
  )
}
