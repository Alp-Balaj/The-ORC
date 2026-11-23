import { useEffect, useState } from 'react'
import { AlertTriangle, CircleCheck, CircleDashed, Repeat, X } from 'lucide-react'
import type { AutopilotPatch, AutopilotView, PlanUsageView, QueueView, SpaceView } from '../../../shared/types'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { modeOptions } from './QueuePanel'

/** Window event that opens the dialog: `detail` is the space root. Fired from the queue's empty state. */
export const LOOP_SETUP_EVENT = 'orc:loop-setup'
export const openLoopSetup = (root: string): void => void window.dispatchEvent(new CustomEvent(LOOP_SETUP_EVENT, { detail: root }))

const clampTo = (value: string, fallback: number, min: number, max: number): number => {
  const n = Math.round(Number(value))
  return value.trim() === '' || !Number.isFinite(n) ? fallback : Math.min(max, Math.max(min, n))
}

type Tone = 'ok' | 'warn' | 'idle'
const stateLabel: Record<AutopilotView['state'], { label: string; tone: Tone }> = {
  off: { label: 'Off', tone: 'idle' },
  idle: { label: 'Waiting for the queue to empty', tone: 'ok' },
  discovering: { label: 'Finding tasks', tone: 'ok' },
  waiting: { label: 'Queue is busy', tone: 'ok' },
  usage: { label: 'Paused by plan usage', tone: 'warn' },
  stopped: { label: 'Stopped', tone: 'warn' }
}

/** Numeric field check, shown inline under the field. Blur still clamps the value into range. */
const numberError = (value: string, min: number, max: number): string | undefined => {
  const n = Number(value)
  return value.trim() === '' || !Number.isFinite(n) || n < min || n > max ? `Enter a number from ${min} to ${max}.` : undefined
}

function Step({ n, title, hint, htmlFor, error, children }: { n: number; title: string; hint: string; htmlFor?: string; error?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="flex gap-3">
      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border text-[11px] tabular-nums text-muted-foreground">{n}</span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <h3 className="text-[12.5px] font-medium text-foreground"><label htmlFor={htmlFor}>{title}</label></h3>
        <p className="text-[11.5px] leading-snug text-muted-foreground">{hint}</p>
        {children}
        {error && <p id={`${htmlFor}-error`} role="alert" className="text-[11.5px] leading-snug text-destructive">{error}</p>}
      </div>
    </section>
  )
}

function Check({ ok, label, detail }: { ok: boolean; label: string; detail: string }): React.JSX.Element {
  return (
    <li className="flex items-start gap-2 text-[12px]" data-ok={ok}>
      {ok ? <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-working" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-needs" />}
      <span className="min-w-0">
        <span className="text-foreground">{label}</span>
        <span className="block text-[11.5px] leading-snug text-muted-foreground">{detail}</span>
      </span>
    </li>
  )
}

/** Guided setup for a space's autopilot loop. Every change applies at once; there is no Save. */
export function LoopSetupDialog({ space, queue, onClose }: { space: SpaceView; queue: QueueView | undefined; onClose: () => void }): React.JSX.Element {
  const root = space.root
  const [entry, setEntry] = useState<AutopilotView | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [usage, setUsage] = useState<PlanUsageView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [maxTasks, setMaxTasks] = useState('5')
  const [maxEmpty, setMaxEmpty] = useState('2')
  const [threshold, setThreshold] = useState(String(space.usageThreshold))

  useEffect(() => {
    const pick = (all: AutopilotView[]): void => {
      setEntry(all.find((a) => a.root === root) ?? null)
      setLoaded(true)
    }
    window.orc.listAutopilot().then(pick).catch((e) => {
      setError(String(e))
      setLoaded(true)
    })
    const off = window.orc.onAutopilot(pick)
    void window.orc.planUsage().then(setUsage).catch(() => {})
    const offUsage = window.orc.onPlanUsage(setUsage)
    return () => {
      off()
      offUsage()
    }
  }, [root])

  const storedMax = entry?.maxTasks ?? 5
  const storedEmpty = entry?.maxEmptyRounds ?? 2
  useEffect(() => {
    setMaxTasks(String(storedMax))
    setMaxEmpty(String(storedEmpty))
  }, [storedMax, storedEmpty])
  useEffect(() => setThreshold(String(space.usageThreshold)), [space.usageThreshold])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const apply = async (patch: AutopilotPatch): Promise<void> => {
    setError(null)
    try {
      await window.orc.autopilotSet(root, patch)
    } catch (e) {
      setError(String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, ''))
    }
  }
  const saveThreshold = (): void => {
    const next = clampTo(threshold, space.usageThreshold, 1, 100)
    setThreshold(String(next))
    if (next !== space.usageThreshold) void window.orc.updateSpace(root, { usageThreshold: next }).catch((e) => setError(String(e)))
  }
  const commitOnEnter = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') e.currentTarget.blur()
  }

  const enabled = entry?.enabled ?? false
  const state = entry?.state ?? 'off'
  const st = stateLabel[state]
  const mode = queue?.permissionMode ?? 'acceptEdits'
  const modeLabel = modeOptions.find((m) => m.value === mode)?.short ?? mode
  const items = queue?.items ?? []
  const open = items.filter((i) => i.status !== 'done').length
  const limitsKnown = !!usage && (!!usage.fiveHour || !!usage.sevenDay)
  const top = Math.max(usage?.fiveHour?.usedPercentage ?? 0, usage?.sevenDay?.usedPercentage ?? 0)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Loop setup" data-testid="loop-setup" className="flex max-h-[85vh] w-full max-w-[520px] flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-2xl">
        <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2">
          <div className="flex items-start gap-2.5">
            <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Repeat className="size-3.5" /></div>
            <div>
              <h2 className="text-[14px] font-semibold">Loop setup</h2>
              <p className="text-[11.5px] leading-snug text-muted-foreground">Adds new tasks to {space.root.split('/').filter(Boolean).pop()} when its queue runs out.</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} title="Close (Esc)" aria-label="Close"><X /></Button>
        </div>

        {!loaded ? (
          <div role="status" className="px-4 pb-6 pt-2 text-[12px] text-muted-foreground" data-testid="loop-loading">Loading loop status…</div>
        ) : (
          <div className="space-y-4 overflow-y-auto px-4 pb-4">
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              When this space's queue runs out of tasks, a cheap read-only Claude session reads the repo and adds new ones, then the queue starts again. It repeats until it finds nothing new, the plan budget runs low, or you turn it off.
            </p>

            <div className={cn('rounded-lg border p-2.5', st.tone === 'warn' && 'border-needs/40')} data-testid="loop-status" data-state={state}>
              <div className="flex items-center justify-between gap-2">
                <span className={cn('flex items-center gap-1.5 text-[12.5px] font-medium', st.tone === 'warn' ? 'text-needs' : st.tone === 'ok' ? 'text-working' : 'text-muted-foreground')}>
                  {st.tone === 'idle' ? <CircleDashed className="size-3.5" /> : st.tone === 'warn' ? <AlertTriangle className="size-3.5" /> : <CircleCheck className="size-3.5" />}
                  {st.label}
                </span>
                {entry && enabled && <span className="text-[11px] tabular-nums text-faint">round {entry.round} · {entry.emptyRounds} empty</span>}
              </div>
              {entry?.status && <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground" data-testid="loop-last-result">{entry.status}</p>}
              {state === 'usage' && <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">Resumes on its own once usage drops under {space.usageThreshold}%, usually when the 5-hour window resets.</p>}
              {state === 'stopped' && (
                <div className="mt-1.5 flex items-center gap-2">
                  <p className="flex-1 text-[11.5px] leading-snug text-muted-foreground">The loop gave up so it doesn't burn usage on nothing. Add tasks yourself or restart it.</p>
                  <Button size="sm" variant="outline" className="h-7 shrink-0" data-testid="loop-restart" onClick={() => void apply({ enabled: false }).then(() => apply({ enabled: true }))}>Restart loop</Button>
                </div>
              )}
              {!entry && <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">The loop hasn't run in this space yet. It starts off; nothing happens until you turn it on.</p>}
            </div>

            {error && <div role="alert" className="rounded-md border border-destructive/40 px-2.5 py-1.5 text-[12px] text-destructive" data-testid="loop-error">Couldn't save: {error}</div>}

            <Step n={1} title="Turn it on" hint="Per space, off by default. Turning it off and on again also clears a stopped loop.">
              <label className="flex cursor-pointer items-center gap-2 text-[12px] text-foreground">
                <input type="checkbox" autoFocus checked={enabled} onChange={(e) => void apply({ enabled: e.target.checked })} className="accent-primary" data-testid="loop-enabled" />
                Keep this space's queue filled
              </label>
            </Step>
            <Step n={2} title="Tasks per round" htmlFor="loop-max-tasks" error={numberError(maxTasks, 1, 10)} hint="The most new tasks one discovery round may add (1-10). Smaller rounds are easier to review.">
              <Input id="loop-max-tasks" type="number" min={1} max={10} placeholder="5" className="w-24" value={maxTasks} onChange={(e) => setMaxTasks(e.target.value)} onKeyDown={commitOnEnter}
                aria-invalid={!!numberError(maxTasks, 1, 10)} aria-describedby="loop-max-tasks-error"
                onBlur={() => { const n = clampTo(maxTasks, 5, 1, 10); setMaxTasks(String(n)); if (n !== storedMax) void apply({ maxTasks: n }) }} data-testid="loop-max-tasks" />
            </Step>
            <Step n={3} title="Stop after empty rounds" htmlFor="loop-max-empty" error={numberError(maxEmpty, 1, 10)} hint="A round that finds nothing new (or fails) counts as empty. This many in a row stops the loop (1-10).">
              <Input id="loop-max-empty" type="number" min={1} max={10} placeholder="2" className="w-24" value={maxEmpty} onChange={(e) => setMaxEmpty(e.target.value)} onKeyDown={commitOnEnter}
                aria-invalid={!!numberError(maxEmpty, 1, 10)} aria-describedby="loop-max-empty-error"
                onBlur={() => { const n = clampTo(maxEmpty, 2, 1, 10); setMaxEmpty(String(n)); if (n !== storedEmpty) void apply({ maxEmptyRounds: n }) }} data-testid="loop-max-empty" />
            </Step>
            <Step n={4} title="Pause at plan usage" htmlFor="loop-threshold" error={numberError(threshold, 1, 100)} hint="Shared with the space's queue: the loop waits while your 5-hour or weekly usage is at or above this percent (1-100).">
              <div className="flex items-center gap-2">
                <Input id="loop-threshold" type="number" min={1} max={100} placeholder="90" className="w-24" value={threshold} onChange={(e) => setThreshold(e.target.value)} onKeyDown={commitOnEnter} onBlur={saveThreshold}
                  aria-invalid={!!numberError(threshold, 1, 100)} aria-describedby="loop-threshold-error" data-testid="loop-threshold" />
                <span className="text-[11.5px] text-muted-foreground">{limitsKnown ? `Now at ${Math.round(top)}%` : 'Current usage not known yet'}</span>
              </div>
            </Step>

            <div className="space-y-1.5 border-t pt-3">
              <h3 className="text-[12.5px] font-medium">Ready?</h3>
              <ul className="space-y-1.5" data-testid="loop-readiness">
                <Check ok={open > 0 || !!queue?.running || items.length === 0} label="Queue" detail={items.length === 0 ? 'Empty: the first round will fill it and start it.' : `${open} open task${open === 1 ? '' : 's'}${queue?.running ? ', running' : queue?.pausedReason ? `, paused: ${queue.pausedReason}` : ''}. The loop waits until none are left.`} />
                <Check ok={mode !== 'manual'} label={`Permission mode: ${modeLabel}`} detail={mode === 'manual' ? 'Every tool call waits for you, so unattended rounds will stall. Pick a mode in the queue.' : 'Discovery uses this mode (read-only tools), and so do the missions it queues.'} />
                <Check ok={limitsKnown} label="Usage limits" detail={limitsKnown ? 'Claude reports your 5-hour and weekly usage, so the pause works.' : 'Not reported yet. Use Claude Code once; until then the loop cannot pause on usage.'} />
              </ul>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 border-t px-4 py-2.5">
          <span className="text-[11.5px] text-muted-foreground">Changes save as you make them.</span>
          <Button size="sm" className="h-7" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  )
}
