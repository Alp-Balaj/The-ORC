import type { PlanUsageView, PlanUsageWindow } from '../shared/types.ts'

/** Epoch seconds, ms, or an ISO string (or a numeric string) → epoch ms. */
function toMs(v: unknown): number | null {
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) v = Number(v)
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v < 1e11 ? Math.round(v * 1000) : Math.round(v)
  if (typeof v === 'string') {
    const t = Date.parse(v)
    return Number.isFinite(t) ? t : null
  }
  return null
}

const pct = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && Number.isFinite(Number(v)) ? Number(v) : null)

/** True when the window is at or over the threshold and hasn't reset yet. */
export function overThreshold(w: PlanUsageWindow | null | undefined, threshold: number, now = Date.now()): boolean {
  return !!w && w.usedPercentage >= threshold && !(w.resetsAt !== null && w.resetsAt <= now)
}

/** The owner's plan usage, read from the status-line JSON Claude Code feeds every session
 *  (`rate_limits`, subscription users only). Status lines fire often: changes are emitted at
 *  most every 2 s, and only when the rounded values change. */
export class PlanUsage {
  private current: PlanUsageView | null = null
  private emitted = ''
  private lastEmit = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private emit: (u: PlanUsageView | null) => void

  constructor(emit: (u: PlanUsageView | null) => void) {
    this.emit = emit
  }

  view(): PlanUsageView | null {
    return this.current
  }

  /** Takes one status-line JSON; returns the status line to show, or null. */
  update(status: unknown): string | null {
    const rl = (status as { rate_limits?: unknown } | null)?.rate_limits
    if (!rl || typeof rl !== 'object') return null
    const raw = rl as Record<string, { used_percentage?: unknown; resets_at?: unknown } | undefined>
    const five = raw.five_hour, week = raw.seven_day
    const p5 = pct(five?.used_percentage), p7 = pct(week?.used_percentage)
    const vals = [p5, p7].filter((v): v is number => v !== null)
    if (!vals.length) return null
    // 0–100 is expected; a fraction (every value ≤ 1, some not whole) is scaled up.
    const scale = vals.every((v) => v <= 1) && vals.some((v) => !Number.isInteger(v)) ? 100 : 1
    const win = (p: number | null, w: { resets_at?: unknown } | undefined): PlanUsageWindow | null =>
      p === null ? null : { usedPercentage: Math.max(0, Math.min(100, p * scale)), resetsAt: toMs(w?.resets_at) }
    this.current = { fiveHour: win(p5, five), sevenDay: win(p7, week), at: Date.now() }
    this.schedule()
    const parts = ['ORC · plan']
    if (this.current.fiveHour) parts.push(`5h ${Math.round(this.current.fiveHour.usedPercentage)}%`)
    if (this.current.sevenDay) parts.push(`${parts.length > 1 ? '· ' : ''}week ${Math.round(this.current.sevenDay.usedPercentage)}%`)
    return parts.join(' ')
  }

  private key(): string {
    const u = this.current
    const k = (w: PlanUsageWindow | null): string => (w ? `${Math.round(w.usedPercentage)}@${w.resetsAt === null ? '' : Math.round(w.resetsAt / 60_000)}` : '-')
    return u ? `${k(u.fiveHour)}|${k(u.sevenDay)}` : ''
  }

  private schedule(): void {
    if (this.timer || this.key() === this.emitted) return
    const wait = Math.max(0, this.lastEmit + 2000 - Date.now())
    this.timer = setTimeout(() => {
      this.timer = null
      const k = this.key()
      if (k === this.emitted) return
      this.emitted = k
      this.lastEmit = Date.now()
      this.emit(this.current)
    }, wait)
    this.timer.unref?.()
  }
}
