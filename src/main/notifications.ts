import type { AgentView, MissionView } from '../shared/types.ts'

/** Desktop notifications. `diffViews` is pure (previous snapshot + new views -> events);
 *  `Notifier` adds focus/selection suppression, coalescing and the badge, and talks to Electron
 *  only through `NotifierDeps`, so it runs without a display (smoke mode passes no-op deps). */

export type NoticeKind = 'needs-you' | 'review' | 'conflict' | 'done' | 'mission-done' | 'exited'

export interface Notice {
  kind: NoticeKind
  missionId: string
  /** Terminal to select on click (the mission's coordinator for mission-level events). */
  terminalId: string
  title: string
  body: string
}

/** Lower sorts first: what needs the owner most. */
const Priority: Record<NoticeKind, number> = { 'needs-you': 0, review: 1, conflict: 1, exited: 2, 'mission-done': 3, done: 4 }

/** What the previous snapshot remembered about each agent / mission. */
export interface Snapshot {
  agents: Map<string, { status: AgentView['status']; merge: AgentView['merge'] }>
  merged: Set<string>
}

export const emptySnapshot = (): Snapshot => ({ agents: new Map(), merged: new Set() })

const key = (m: MissionView, a: AgentView): string => `${m.id}/${a.name}`

function snapshotOf(missions: MissionView[]): Snapshot {
  const s = emptySnapshot()
  for (const m of missions) {
    if (m.mergedToMain) s.merged.add(m.id)
    for (const a of m.agents) s.agents.set(key(m, a), { status: a.status, merge: a.merge })
  }
  return s
}

/** Events for each transition between `prev` and `missions`. `prev` null = first snapshot: it
 *  only sets the baseline (nothing that was already true at launch is announced). A status that
 *  is unchanged since the last snapshot never repeats, so re-emits are silent. */
export function diffViews(prev: Snapshot | null, missions: MissionView[], enabled: (repoPath: string) => boolean = () => true): { next: Snapshot; notices: Notice[] } {
  const next = snapshotOf(missions)
  if (!prev) return { next, notices: [] }
  const notices: Notice[] = []
  for (const m of missions) {
    if (!enabled(m.repoPath)) continue
    const coordinator = `${m.id}:coordinator`
    if (m.mergedToMain && !prev.merged.has(m.id)) {
      notices.push({ kind: 'mission-done', missionId: m.id, terminalId: coordinator, title: m.name, body: `${m.name} finished: merged to ${m.mainBranch}` })
    }
    for (const a of m.agents) {
      // A brand-new agent counts as having just started.
      const before = prev.agents.get(key(m, a)) ?? { status: 'starting' as const, merge: null }
      const at = `${a.name} · ${m.name}`
      const base = { missionId: m.id, terminalId: a.terminalId }
      if (a.status !== before.status) {
        if (a.status === 'needs-you') {
          const what = a.question ? 'has a question' : 'needs your approval'
          notices.push({ ...base, kind: 'needs-you', title: m.name, body: `${a.name} ${what} · ${m.name}${a.question ? `\n${a.question.slice(0, 120)}` : ''}` })
        } else if (a.status === 'exited' && !a.shutDown && m.state === 'running' && !m.paused && before.status !== 'exited') {
          notices.push({ ...base, kind: 'exited', title: m.name, body: `${a.name} exited unexpectedly · ${m.name}` })
        } else if (a.status === 'done' && a.role === 'worker') {
          notices.push({ ...base, kind: 'done', title: m.name, body: `${a.name} reported done · ${m.name}${a.doneSummary ? `\n${a.doneSummary.slice(0, 120)}` : ''}` })
        }
      }
      if (a.merge !== before.merge) {
        if (a.merge === 'review') notices.push({ ...base, kind: 'review', title: m.name, body: `${at}: diff waits for your review` })
        else if (a.merge === 'conflict') notices.push({ ...base, kind: 'conflict', title: m.name, body: `${at}: merge conflict in ${a.conflictFiles.length || 'some'} file(s)` })
      }
    }
  }
  return { next, notices }
}

/** Number of agents waiting on the owner, in spaces where notifications are on. */
export function needsYouCount(missions: MissionView[], enabled: (repoPath: string) => boolean = () => true): number {
  let n = 0
  for (const m of missions) {
    if (m.state !== 'running' || !enabled(m.repoPath)) continue
    for (const a of m.agents) if (a.status === 'needs-you') n++
  }
  return n
}

export interface NotifierDeps {
  /** Shows one OS notification; `onClick` fires when the owner clicks it. */
  show: (n: { title: string; body: string; urgent: boolean }, onClick: () => void) => void
  setBadge: (count: number) => void
  /** Taskbar attention flash on/off. */
  flash: (on: boolean) => void
  isFocused: () => boolean
  /** Brings the window forward and selects the mission/agent in it. */
  select: (missionId: string, terminalId: string) => void
  enabled: (repoPath: string) => boolean
}

const CoalesceMs = 600

export class Notifier {
  private prev: Snapshot | null = null
  private pending: Notice[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private selected: { missionId: string | null; terminalId: string | null } = { missionId: null, terminalId: null }
  private readonly deps: NotifierDeps
  private lastNeeds = 0

  constructor(deps: NotifierDeps) {
    this.deps = deps
  }

  /** The mission/agent on screen in the renderer. */
  setSelection(missionId: string | null, terminalId: string | null): void {
    this.selected = { missionId, terminalId }
  }

  /** The window gained focus: whatever was flashing has been seen. */
  onFocus(): void {
    this.deps.flash(false)
  }

  onMissions(missions: MissionView[]): void {
    const { next, notices } = diffViews(this.prev, missions, this.deps.enabled)
    this.prev = next
    const needs = needsYouCount(missions, this.deps.enabled)
    if (needs !== this.lastNeeds) {
      this.deps.setBadge(needs)
      if (needs > this.lastNeeds && !this.deps.isFocused()) this.deps.flash(true)
      this.lastNeeds = needs
    }
    for (const n of notices) if (!this.onScreen(n)) this.pending.push(n)
    if (this.pending.length && !this.timer) this.timer = setTimeout(() => this.flush(), CoalesceMs)
  }

  /** Window focused and the thing is already in front of the owner. Mission-level events only
   *  need the mission to be selected; agent events need that agent. */
  private onScreen(n: Notice): boolean {
    if (!this.deps.isFocused() || this.selected.missionId !== n.missionId) return false
    return n.kind === 'mission-done' || this.selected.terminalId === n.terminalId
  }

  private flush(): void {
    this.timer = null
    const batch = this.pending.sort((a, b) => Priority[a.kind] - Priority[b.kind])
    this.pending = []
    if (!batch.length) return
    const top = batch[0]
    const urgent = top.kind === 'needs-you'
    if (batch.length === 1) {
      this.deps.show({ title: top.title, body: top.body, urgent }, () => this.deps.select(top.missionId, top.terminalId))
    } else {
      const lines = batch.slice(0, 3).map((n) => n.body.split('\n')[0])
      if (batch.length > 3) lines.push(`and ${batch.length - 3} more`)
      this.deps.show({ title: `${batch.length} updates in The ORC`, body: lines.join('\n'), urgent }, () => this.deps.select(top.missionId, top.terminalId))
    }
  }
}
