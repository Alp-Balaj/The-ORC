import { useEffect, useState } from 'react'
import type { PlanUsageView, PlanUsageWindow } from '../../../shared/types'
import { cn } from '../lib/utils'

/** Status tone by percent used: normal, warning (from the queue threshold, default 80), near-limit (95). */
function tone(p: number, warnAt: number): 'ok' | 'warn' | 'hot' {
  return p >= Math.max(95, warnAt) ? 'hot' : p >= warnAt ? 'warn' : 'ok'
}
const barColor = { ok: 'bg-working', warn: 'bg-needs', hot: 'bg-destructive' }
const textColor = { ok: 'text-muted-foreground', warn: 'text-needs', hot: 'text-destructive' }

function untilReset(at: number | null, now: number): string {
  if (!at) return ''
  const m = Math.max(0, Math.round((at - now) / 60_000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

function Meter({ label, w, warnAt, now, compact }: { label: string; w: PlanUsageWindow; warnAt: number; now: number; compact?: boolean }): React.JSX.Element {
  const expired = w.resetsAt !== null && w.resetsAt <= now
  const p = expired ? 0 : Math.round(w.usedPercentage)
  const t = tone(p, warnAt)
  return (
    <div className="flex items-center gap-1.5 text-[11px] tabular-nums" data-testid={`plan-usage-${label}`}>
      <span className="text-faint">{label}</span>
      <div className={cn('h-1.5 overflow-hidden rounded-full bg-muted', compact ? 'w-8' : 'w-14')} role="meter" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100} aria-label={`${label} plan usage`}>
        <div className={cn('h-full rounded-full transition-[width]', barColor[t])} style={{ width: `${Math.min(100, p)}%` }} />
      </div>
      <span className={cn('min-w-[2.5ch] text-right font-medium', textColor[t])}>{p}%</span>
      {w.resetsAt && !expired && <span className="hidden text-faint min-[1500px]:inline">↻ {untilReset(w.resetsAt, now)}</span>}
    </div>
  )
}

/** Subscription plan usage (5-hour session and weekly windows) in the main header. */
export function PlanUsageHeader({ warnAt = 80, className, warnOnly }: { warnAt?: number; className?: string; warnOnly?: boolean }): React.JSX.Element {
  const [usage, setUsage] = useState<PlanUsageView | null>(null)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    void window.orc.planUsage().then(setUsage)
    const off = window.orc.onPlanUsage(setUsage)
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => { off(); clearInterval(t) }
  }, [])
  const five = usage?.fiveHour, week = usage?.sevenDay
  const title = !usage || (!five && !week)
    ? 'Plan usage appears after the first Claude session reports it (subscription plans only).'
    : [
        five && `5-hour session: ${Math.round(five.usedPercentage)}% used${five.resetsAt ? `, resets in ${untilReset(five.resetsAt, now)}` : ''}`,
        week && `Weekly: ${Math.round(week.usedPercentage)}% used${week.resetsAt ? `, resets in ${untilReset(week.resetsAt, now)}` : ''}`,
        `Queues pause at ${warnAt}%`
      ].filter(Boolean).join('\n')
  // Header mode: only appear once a window reaches the warning tone; the full meters live in the settings menu.
  if (warnOnly && ![five, week].some((w) => w && !(w.resetsAt !== null && w.resetsAt <= now) && tone(Math.round(w.usedPercentage), warnAt) !== 'ok')) return <></>
  return (
    <div className={cn('flex shrink-0 items-center gap-3', className)} title={title} data-testid="plan-usage">
      {five || week ? (
        <>
          {five && <Meter label="5h" w={five} warnAt={warnAt} now={now} compact />}
          {week && <span className="hidden min-[1200px]:contents"><Meter label="wk" w={week} warnAt={warnAt} now={now} compact /></span>}
        </>
      ) : (
        <span className="text-[11px] text-faint">Plan usage: waiting for data</span>
      )}
    </div>
  )
}
