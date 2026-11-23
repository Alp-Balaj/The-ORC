import { useState } from 'react'
import { ChevronDown, ChevronRight, Circle, CircleCheck, CirclePause, GripVertical, ListOrdered, LoaderCircle, Pause, Play, Plus, Trash2 } from 'lucide-react'
import type { PermissionMode, PlanUsageView, QueueItem, QueueView } from '../../../shared/types'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import { Input, NativeSelect } from './ui/input'

export const modeOptions: { value: PermissionMode; label: string; short: string }[] = [
  { value: 'acceptEdits', label: 'Accept edits (ask for commands)', short: 'Accept edits' },
  { value: 'auto', label: 'Auto', short: 'Auto' },
  { value: 'manual', label: 'Ask for everything', short: 'Ask all' },
  { value: 'bypassPermissions', label: 'Bypass permissions', short: 'Bypass' }
]

const errText = (err: unknown): string => String(err).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '')

function StatusIcon({ status, className }: { status: QueueItem['status']; className?: string }): React.JSX.Element {
  if (status === 'running') return <LoaderCircle className={cn('size-3 shrink-0 animate-spin text-working', className)} aria-label="running" />
  if (status === 'done') return <CircleCheck className={cn('size-3 shrink-0 text-done', className)} aria-label="done" />
  if (status === 'paused') return <CirclePause className={cn('size-3 shrink-0 text-needs', className)} aria-label="paused" />
  return <Circle className={cn('size-3 shrink-0 text-faint', className)} aria-label="queued" />
}

/** A space's backlog: tasks that each become a mission, run one after another. */
export function QueuePanel({ root, queue, onSelectMission }: {
  root: string
  queue: QueueView | undefined
  onSelectMission: (id: string) => void
}): React.JSX.Element {
  const items = queue?.items ?? []
  const pending = items.filter((i) => i.status !== 'done').length
  const doneCount = items.length - pending
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [showDetails, setShowDetails] = useState(false)
  const [mode, setMode] = useState<PermissionMode | null>(null)
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const running = queue?.running ?? false
  const permissionMode = mode ?? queue?.permissionMode ?? 'acceptEdits'

  const run = (p: Promise<unknown>): void => {
    setError(null)
    p.catch((err) => setError(errText(err)))
  }

  function add(): void {
    if (!title.trim()) return
    run(window.orc.queueAdd(root, title.trim(), details.trim()))
    setTitle('')
    setDetails('')
    setShowDetails(false)
  }

  function drop(target: string): void {
    const from = items.findIndex((i) => i.id === drag)
    const to = items.findIndex((i) => i.id === target)
    setDrag(null)
    setOver(null)
    if (from < 0 || to < 0 || from === to) return
    const ids = items.map((i) => i.id)
    ids.splice(to, 0, ...ids.splice(from, 1))
    run(window.orc.queueReorder(root, ids))
  }
  const dragFrom = items.findIndex((i) => i.id === drag)

  return (
    <div className="ml-2.5 mt-0.5 border-l border-border pl-1.5" data-testid="queue" data-running={running}>
      <div className="group/q flex h-7 items-center gap-1 rounded-md px-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent">
        <button className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left hover:text-foreground" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="queue-toggle">
          {open ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
          <ListOrdered className="size-3 shrink-0" />
          <span className="font-medium">Queue</span>
          {pending > 0 && <span className="text-[11px] tabular-nums text-faint">{pending}</span>}
          {running ? (
            <span className="text-[10.5px] text-working">running</span>
          ) : queue?.pausedReason ? (
            <span className="text-[10.5px] text-needs">paused</span>
          ) : null}
        </button>
        {pending > 0 && (running ? (
          <Button size="xs" variant="ghost" className="h-5 px-1.5" title="Pause the queue. The running mission keeps going; the next task waits." data-testid="queue-pause" onClick={() => run(window.orc.queuePause(root))}>
            <Pause /> Pause
          </Button>
        ) : (
          <Button size="xs" variant="ghost" className="h-5 px-1.5 text-foreground" title={`Start the queue (${modeOptions.find((m) => m.value === permissionMode)?.label})`} data-testid="queue-start" onClick={() => run(window.orc.queueStart(root, permissionMode))}>
            <Play /> {queue?.pausedReason ? 'Resume' : 'Start'}
          </Button>
        ))}
      </div>
      {!running && queue?.pausedReason && (
        <div className="mb-1 px-1.5 text-[11px] leading-snug text-needs" data-testid="queue-paused-reason">
          Paused: {queue.pausedReason}
          {queue.pausedByUsage && <span className="text-muted-foreground"> Resumes when the 5-hour window resets.</span>}
        </div>
      )}
      {error && <div className="mb-1 px-1.5 text-[11px] text-destructive">{error}</div>}
      {open && (
        <div className="space-y-1 pb-1.5 pt-0.5">
          {items.length === 0 && (
            <div className="px-1.5 text-[11px] leading-snug text-faint" data-testid="queue-empty">
              No tasks yet. Each task becomes its own mission, started when the one before it is verified.
            </div>
          )}
          {items.length > 0 && (
            <ul className="space-y-px" onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(null) }}>
              {items.map((it, idx) => {
                const canDrag = it.status === 'queued'
                const isOver = over === it.id && drag !== it.id
                return (
                  <li
                    key={it.id}
                    draggable={canDrag}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move'
                      setDrag(it.id)
                    }}
                    onDragEnd={() => {
                      setDrag(null)
                      setOver(null)
                    }}
                    onDragOver={(e) => {
                      if (!drag || it.status !== 'queued') return
                      e.preventDefault()
                      setOver(it.id)
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      drop(it.id)
                    }}
                    data-testid="queue-item"
                    data-status={it.status}
                    className={cn(
                      'group/item relative rounded-md px-1.5 py-1 transition-colors hover:bg-accent',
                      drag === it.id && 'opacity-40',
                      isOver && (idx < dragFrom ? 'shadow-[inset_0_2px_0] shadow-primary' : 'shadow-[inset_0_-2px_0] shadow-primary')
                    )}
                    title={it.details || undefined}
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      {canDrag ? (
                        <GripVertical className="absolute left-1.5 top-1/2 size-3 -translate-y-1/2 cursor-grab text-faint opacity-0 group-hover/item:opacity-100" />
                      ) : null}
                      <StatusIcon status={it.status} className={canDrag ? 'group-hover/item:opacity-0' : undefined} />
                      {it.status === 'running' && it.missionId ? (
                        <button className="min-w-0 cursor-pointer truncate text-left text-[12px] font-medium text-foreground hover:underline" onClick={() => onSelectMission(it.missionId!)} title={`Open mission ${it.missionName ?? ''}`} data-testid="queue-item-mission">
                          {it.title}
                        </button>
                      ) : (
                        <span className={cn('min-w-0 truncate text-[12px]', it.status === 'done' ? 'text-faint line-through' : 'text-foreground')}>{it.title}</span>
                      )}
                      {it.status !== 'running' && (
                        <button
                          className="ml-auto grid size-4 shrink-0 cursor-pointer place-items-center rounded text-faint opacity-0 transition-[opacity,color] hover:text-destructive focus-visible:opacity-100 group-hover/item:opacity-100"
                          aria-label={`Remove ${it.title}`}
                          title="Remove from the queue"
                          data-testid="queue-remove"
                          onClick={() => run(window.orc.queueRemove(root, it.id))}
                        >
                          <Trash2 className="size-3" />
                        </button>
                      )}
                    </div>
                    {(it.status === 'running' || it.status === 'done') && it.missionName && (
                      <div className="truncate pl-4.5 text-[10.5px] text-faint">{it.missionName}</div>
                    )}
                    {it.reason && <div className="pl-4.5 text-[10.5px] leading-snug text-needs">{it.reason}</div>}
                  </li>
                )
              })}
            </ul>
          )}
          {items.length > 0 && (
            <div className="flex items-center gap-1 px-1.5 text-[11px]" data-testid="queue-clear-row">
              {doneCount > 0 && (
                <Button size="xs" variant="ghost" className="h-5 px-1.5 text-muted-foreground" title="Remove finished tasks from the list" data-testid="queue-clear-done" onClick={() => run(window.orc.queueClear(root, 'done'))}>
                  Clear done ({doneCount})
                </Button>
              )}
              {confirmAll ? (
                <span className="ml-auto flex items-center gap-1 text-needs">
                  Clear all?
                  <Button size="xs" variant="ghost" className="h-5 px-1.5 text-destructive" data-testid="queue-clear-all-confirm" onClick={() => { setConfirmAll(false); run(window.orc.queueClear(root, 'all')) }}>Yes</Button>
                  <Button size="xs" variant="ghost" className="h-5 px-1.5" onClick={() => setConfirmAll(false)}>No</Button>
                </span>
              ) : (
                <Button size="xs" variant="ghost" className="ml-auto h-5 px-1.5 text-muted-foreground" title="Remove every task except the running one" data-testid="queue-clear-all" onClick={() => setConfirmAll(true)}>
                  Clear all
                </Button>
              )}
            </div>
          )}
          <form
            className="space-y-1 px-1.5 pt-0.5"
            onSubmit={(e) => {
              e.preventDefault()
              add()
            }}
          >
            <div className="flex gap-1">
              <Input className="h-7 text-[12px]" placeholder="Add a task, e.g. dark mode toggle" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="queue-title" />
              <Button type="button" size="icon-sm" variant="ghost" className={cn('size-7 shrink-0', showDetails && 'text-foreground')} title="Add details" aria-pressed={showDetails} onClick={() => setShowDetails(!showDetails)}>
                <Plus />
              </Button>
            </div>
            {showDetails && (
              <textarea
                className="block min-h-14 w-full resize-y rounded-md border border-border-strong bg-background px-2.5 py-1.5 text-[12px] placeholder:text-faint focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
                placeholder="Details for the coordinator (optional). Ctrl+Enter adds."
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault()
                    add()
                  }
                }}
                data-testid="queue-details"
              />
            )}
            {!running && pending > 0 && (
              <NativeSelect className="h-7 px-1.5 text-[11px] text-muted-foreground" value={permissionMode} onChange={(e) => setMode(e.target.value as PermissionMode)} title="Permission mode for the missions the queue starts" data-testid="queue-mode">
                {modeOptions.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </NativeSelect>
            )}
          </form>
        </div>
      )}
    </div>
  )
}

const pct = (n: number): number => Math.round(n)
const resetText = (at: number | null): string => (at ? new Date(at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'unknown')

/** "5h 42% · wk 17%" with a tiny bar for the higher one. Amber at or over the threshold. */
export function PlanUsageMeter({ usage, threshold }: { usage: PlanUsageView | null; threshold: number }): React.JSX.Element | null {
  if (!usage || (!usage.fiveHour && !usage.sevenDay)) return null
  const five = usage.fiveHour?.usedPercentage ?? 0
  const week = usage.sevenDay?.usedPercentage ?? 0
  const top = Math.max(five, week)
  const hot = top >= threshold
  const title = [
    usage.fiveHour && `5-hour window: ${pct(five)}% used, resets ${resetText(usage.fiveHour.resetsAt)}`,
    usage.sevenDay && `Weekly: ${pct(week)}% used, resets ${resetText(usage.sevenDay.resetsAt)}`,
    `Queues pause at ${threshold}%`
  ].filter(Boolean).join('\n')
  return (
    <div className="border-t px-3 py-2" title={title} data-testid="plan-usage">
      <div className={cn('flex items-center gap-1.5 text-[11px] tabular-nums', hot ? 'text-needs' : 'text-muted-foreground')}>
        <span className="text-faint">Plan</span>
        {usage.fiveHour && <span>5h {pct(five)}%</span>}
        {usage.fiveHour && usage.sevenDay && <span className="text-faint">·</span>}
        {usage.sevenDay && <span>wk {pct(week)}%</span>}
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full transition-[width]', hot ? 'bg-needs' : 'bg-muted-foreground/60')} style={{ width: `${Math.min(100, top)}%` }} />
      </div>
    </div>
  )
}
