import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import type { MissionView, PermissionMode, PlanUsageView, QueueItem, QueueView, StartMissionRequest } from '../shared/types.ts'
import { integrationBranch } from './mission-git.ts'
import { overThreshold } from './plan-usage.ts'
import { renameOver } from './rename-over.ts'

const FileVersion = 1

/** Red flags the owner saw when resuming: they must not pause the queue again. */
interface Ack {
  gateAt: number | null
  verifierAt: number | null
  questions: string[]
  stopped: boolean
}

interface QueueState extends QueueView {
  acks: Record<string, Ack>
  /** Paused by usage: when to check again (epoch ms). Saved, so a restart re-arms it. */
  usageResumeAt: number | null
}

export interface QueueDeps {
  missions: { views(): MissionView[]; startMission(req: StartMissionRequest): Promise<string> }
  usageThreshold: (root: string) => number
  usage: () => PlanUsageView | null
  emit: (queues: QueueView[]) => void
  /** Null: memory only (smoke runs). */
  file: string | null
}

const verdictOf = (report: string): string | null => /VERDICT:\s*(\w+)/.exec(report)?.[1]?.toUpperCase() ?? null

function firstProblem(report: string): string {
  const lines = report.split('\n')
  const i = lines.findIndex((l) => /^\s*PROBLEMS:/.test(l))
  if (i < 0) return report.trim().split('\n')[0]?.slice(0, 200) ?? ''
  const same = lines[i].replace(/^\s*PROBLEMS:\s*/, '').trim()
  const line = same || lines.slice(i + 1).find((l) => l.trim())?.trim() || ''
  return line.replace(/^[-*•]\s*/, '').slice(0, 200)
}

const nameSlug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36).replace(/-$/, '') || 'task'

const MaxTimer = 2 ** 31 - 1

/** Per-space backlog queues: each item becomes its own mission, stacked on the previous one,
 *  started when the previous one is verified PASS. Any red flag pauses the queue (never the
 *  running mission). */
export class Queues {
  private queues = new Map<string, QueueState>()
  private starting = new Set<string>()
  private views: MissionView[] = []
  /** No decisions before the first missions list (restore may still be running). */
  private ready = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private deps: QueueDeps

  constructor(deps: QueueDeps) {
    this.deps = deps
    if (deps.file) {
      try {
        const data = JSON.parse(readFileSync(deps.file, 'utf8')) as { version?: number; queues?: QueueState[] }
        for (const q of data.queues ?? []) {
          if (!q || typeof q.root !== 'string' || !Array.isArray(q.items)) continue
          this.queues.set(q.root, {
            root: q.root,
            running: !!q.running,
            pausedReason: q.pausedReason ?? null,
            pausedByUsage: !!q.pausedByUsage,
            permissionMode: q.permissionMode ?? 'bypassPermissions',
            items: q.items,
            acks: q.acks ?? {},
            usageResumeAt: q.usageResumeAt ?? null
          })
        }
      } catch {}
    }
    this.armTimer()
  }

  list(): QueueView[] {
    return [...this.queues.values()].map(({ acks: _a, usageResumeAt: _u, ...v }) => ({ ...v, items: v.items.map((i) => ({ ...i })) }))
  }

  private get(root: string, permissionMode?: PermissionMode): QueueState {
    let q = this.queues.get(root)
    if (!q) {
      q = { root, running: false, pausedReason: null, pausedByUsage: false, permissionMode: permissionMode ?? 'bypassPermissions', items: [], acks: {}, usageResumeAt: null }
      this.queues.set(root, q)
    }
    return q
  }

  private changed(): void {
    if (this.deps.file) {
      try {
        const data = { version: FileVersion, queues: [...this.queues.values()] }
        writeFileSync(`${this.deps.file}.tmp`, JSON.stringify(data))
        renameOver(`${this.deps.file}.tmp`, this.deps.file)
      } catch (err) {
        console.error('could not save queues', err)
      }
    }
    this.deps.emit(this.list())
  }

  add(root: string, title: string, details: string): void {
    const t = title.trim()
    if (!t) throw new Error('a task needs a title')
    const q = this.get(root)
    q.items.push({ id: randomUUID(), title: t, details: details.trim(), status: 'queued', missionId: null, missionName: null, reason: null, createdAt: Date.now() })
    this.changed()
    this.evaluate(q)
  }

  update(root: string, id: string, patch: { title?: string; details?: string }): void {
    const item = this.queues.get(root)?.items.find((i) => i.id === id)
    if (!item) throw new Error('no such queue item')
    if (item.missionId) throw new Error('this task has started; it can no longer be edited')
    if (patch.title !== undefined && patch.title.trim()) item.title = patch.title.trim()
    if (patch.details !== undefined) item.details = patch.details.trim()
    this.changed()
  }

  remove(root: string, id: string): void {
    const q = this.queues.get(root)
    const item = q?.items.find((i) => i.id === id)
    if (!q || !item) return
    if (item.status === 'running') throw new Error('this task is running; stop its mission or wait for it to finish')
    q.items = q.items.filter((i) => i.id !== id)
    delete q.acks[id]
    this.changed()
  }

  reorder(root: string, ids: string[]): void {
    const q = this.queues.get(root)
    if (!q) return
    const pos = new Map(ids.map((id, i) => [id, i]))
    q.items = [...q.items].sort((a, b) => (pos.get(a.id) ?? Infinity) - (pos.get(b.id) ?? Infinity))
    this.changed()
  }

  /** Owner starts or resumes: red flags present now are acknowledged. */
  start(root: string, permissionMode: PermissionMode): void {
    const q = this.get(root, permissionMode)
    q.permissionMode = permissionMode
    q.running = true
    q.pausedReason = null
    q.pausedByUsage = false
    q.usageResumeAt = null
    for (const item of q.items) {
      if (item.status !== 'paused' && item.status !== 'running') continue
      item.reason = null
      const m = this.views.find((v) => v.id === item.missionId)
      if (!m) {
        // Never started (startMission failed): try again. Its mission was removed: move on.
        if (item.missionId) item.status = 'done'
        else item.status = 'queued'
        continue
      }
      item.status = 'running'
      q.acks[item.id] = {
        gateAt: m.gate && !m.gate.ok ? m.gate.at : null,
        verifierAt: m.verifier && m.verifier.status !== 'running' ? m.verifier.at : null,
        questions: m.agents.filter((a) => a.question).map((a) => `${a.name}:${a.question}`),
        stopped: m.state === 'stopped'
      }
    }
    this.changed()
    this.armTimer()
    this.evaluate(q)
  }

  pause(root: string): void {
    const q = this.queues.get(root)
    if (!q) return
    q.running = false
    q.pausedReason = 'paused by you'
    q.pausedByUsage = false
    q.usageResumeAt = null
    this.changed()
    this.armTimer()
  }

  onMissions(views: MissionView[]): void {
    this.views = views
    this.ready = true
    for (const q of this.queues.values()) this.evaluate(q)
  }

  onUsage(): void {
    for (const q of this.queues.values()) if (q.running) this.evaluate(q)
  }

  private pauseOn(q: QueueState, item: QueueItem | null, reason: string): void {
    q.running = false
    q.pausedReason = reason
    if (item) {
      item.status = 'paused'
      item.reason = reason
    }
    this.changed()
  }

  /** Reason the queue must pause for usage, or null. */
  private usageFlag(root: string): string | null {
    const u = this.deps.usage()
    const t = this.deps.usageThreshold(root)
    if (overThreshold(u?.fiveHour, t)) return `plan usage 5-hour ${Math.round(u!.fiveHour!.usedPercentage)}% ≥ ${t}%`
    if (overThreshold(u?.sevenDay, t)) return `plan usage weekly ${Math.round(u!.sevenDay!.usedPercentage)}% ≥ ${t}%`
    return null
  }

  private redFlag(m: MissionView, ack: Ack | undefined): string | null {
    const v = m.verifier
    if (v && v.at !== ack?.verifierAt) {
      if (v.status === 'failed') return `Verifier failed — ${firstProblem(v.report) || 'no report'}`
      if (v.status === 'done' && v.integrationCommit === m.integrationCommit) {
        const verdict = verdictOf(v.report)
        if (verdict !== 'PASS') return `Verifier: ${verdict ?? 'no verdict'} — ${firstProblem(v.report)}`
      }
    }
    if (m.gate && !m.gate.ok && m.gate.at !== ack?.gateAt) return `gate failed: ${m.gate.command} (exit ${m.gate.exitCode ?? '?'})`
    const asked = m.agents.find((a) => a.question && !ack?.questions.includes(`${a.name}:${a.question}`))
    if (asked) return `${asked.name} asked: ${asked.question}`
    if (m.state === 'stopped' && !ack?.stopped) return 'mission stopped'
    return null
  }

  private finished(m: MissionView, ack: Ack | undefined): boolean {
    if (m.mergedToMain) return true
    // A stopped mission the owner resumed past will never be verified: move on.
    if (m.state === 'stopped' && ack?.stopped) return true
    const v = m.verifier
    if (!v || v.status === 'running' || v.integrationCommit !== m.integrationCommit) return false
    if (v.status === 'done' && verdictOf(v.report) === 'PASS') return true
    return v.at === ack?.verifierAt
  }

  private evaluate(q: QueueState): void {
    if (!q.running || !this.ready || this.starting.has(q.root)) return
    const usage = this.usageFlag(q.root)
    if (usage) return this.pauseForUsage(q, usage)
    const item = q.items.find((i) => i.status === 'running')
    if (item) {
      const m = this.views.find((v) => v.id === item.missionId)
      if (!m) return this.pauseOn(q, item, 'mission removed')
      if (!m.mergedToMain) {
        const flag = this.redFlag(m, q.acks[item.id])
        if (flag) return this.pauseOn(q, item, flag)
      }
      if (!this.finished(m, q.acks[item.id])) return
      item.status = 'done'
      item.reason = null
      this.changed()
    }
    const next = q.items.find((i) => i.status === 'queued')
    if (!next) return
    void this.startItem(q, next)
  }

  /** Base and main branch for the next item: on top of the last finished item's mission. */
  private stackOn(q: QueueState): { baseBranch?: string; mainBranch?: string } {
    const prev = q.items
      .filter((i) => i.status === 'done' && i.missionId)
      .map((i) => this.views.find((v) => v.id === i.missionId))
      .filter((m): m is MissionView => !!m)
      .sort((a, b) => b.createdAt - a.createdAt)[0]
    if (!prev) return {}
    const baseBranch = prev.mergedToMain ? prev.mainBranch : prev.integrationCommit ? integrationBranch(prev.name) : prev.baseBranch
    return { baseBranch, mainBranch: prev.mainBranch }
  }

  private async startItem(q: QueueState, item: QueueItem): Promise<void> {
    this.starting.add(q.root)
    try {
      const taken = new Set(this.views.map((v) => v.name))
      const base = nameSlug(item.title)
      const brief = item.title + (item.details ? '\n\n' + item.details : '')
      for (let n = 1; ; n++) {
        const name = n === 1 ? base : `${base}-${n}`
        if (taken.has(name)) continue
        try {
          const id = await this.deps.missions.startMission({
            repoPath: q.root,
            name,
            permissionMode: q.permissionMode,
            gating: 'none',
            brief,
            ...this.stackOn(q),
            queueItemId: item.id
          })
          item.status = 'running'
          item.missionId = id
          item.missionName = name
          item.reason = null
          this.changed()
          return
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (n < 50 && /already exists|ran in this repository before/.test(msg)) continue
          this.pauseOn(q, item, `could not start: ${msg}`)
          return
        }
      }
    } finally {
      this.starting.delete(q.root)
    }
  }

  private pauseForUsage(q: QueueState, reason: string): void {
    const u = this.deps.usage()
    const now = Date.now()
    const five = u?.fiveHour?.resetsAt
    q.usageResumeAt = (five && five > now ? five : now + 30 * 60_000) + 30_000
    q.pausedByUsage = true
    this.pauseOn(q, null, reason)
    this.armTimer()
  }

  private armTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const at = Math.min(...[...this.queues.values()].filter((q) => q.pausedByUsage && q.usageResumeAt).map((q) => q.usageResumeAt!))
    if (!Number.isFinite(at)) return
    this.timer = setTimeout(() => this.usageTimer(), Math.min(MaxTimer, Math.max(1000, at - Date.now())))
    this.timer.unref?.()
  }

  private usageTimer(): void {
    this.timer = null
    const now = Date.now()
    for (const q of this.queues.values()) {
      if (!q.pausedByUsage || !q.usageResumeAt || q.usageResumeAt > now) continue
      const u = this.deps.usage()
      const t = this.deps.usageThreshold(q.root)
      if (overThreshold(u?.sevenDay, t, now)) {
        const r = u!.sevenDay!.resetsAt
        q.usageResumeAt = (r && r > now ? r : now + 60 * 60_000) + 30_000
      } else if (overThreshold(u?.fiveHour, t, now)) {
        const r = u!.fiveHour!.resetsAt
        q.usageResumeAt = (r && r > now ? r : now + 30 * 60_000) + 30_000
      } else {
        q.running = true
        q.pausedByUsage = false
        q.pausedReason = null
        q.usageResumeAt = null
        this.changed()
        this.evaluate(q)
        continue
      }
      this.changed()
    }
    this.armTimer()
  }
}
