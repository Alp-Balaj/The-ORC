import { Fragment, useEffect, useState } from 'react'
import { Compass, GitBranch, Play } from 'lucide-react'
import type { MainSessionView, MissionView, QueueItem, QueueView, SpaceView } from '../../../shared/types'
import { missionAttention, tierBg } from '../lib/attention'
import { ago, cn, formatTokens } from '../lib/utils'
import { StatusDot, statusLabel } from './AgentCard'
import { Button } from './ui/button'

const sectionTitle = 'mb-2 text-[11px] font-medium uppercase tracking-wide text-faint'

/** One repo's overview: its missions, main session, backlog and recent activity. Read-only except for opening things. */
export function RepoDashboard({ root, space, missions, main, onOpenMission, onOpenMain }: {
  root: string
  space: SpaceView | undefined
  missions: MissionView[]
  main: MainSessionView | undefined
  onOpenMission: (id: string) => void
  onOpenMain: () => void
}): React.JSX.Element {
  const [queue, setQueue] = useState<QueueView | null>(null)
  useEffect(() => {
    let live = true
    void window.orc.listQueues().then((qs) => { if (live) setQueue(qs.find((q) => q.root === root) ?? null) })
    const off = window.orc.onQueues((qs) => setQueue(qs.find((q) => q.root === root) ?? null))
    return () => {
      live = false
      off()
    }
  }, [root])

  const name = space?.name ?? root.split(/[\\/]/).pop() ?? root
  const ms = missions.filter((m) => m.repoPath === root).sort((a, b) => b.createdAt - a.createdAt)
  const running = ms.filter((m) => m.state === 'running').length
  const stopped = ms.filter((m) => m.state === 'stopped').length
  const merged = ms.filter((m) => m.mergedToMain).length
  const needs = ms.reduce((n, m) => n + missionAttention(m).needs, 0)
  const mainBranch = ms[0]?.mainBranch ?? null
  // The ORC branch: what integrated missions were based on (unknown until a mission integrates).
  const orcBranch = ms.find((m) => m.integrated)?.baseBranch ?? null
  const stats = [
    { n: running, label: 'running' },
    { n: stopped, label: 'stopped' },
    { n: merged, label: 'merged to main' },
    { n: needs, label: 'need you', tone: 'text-needs' }
  ]

  const mainLive = !!main && main.status !== 'off' && main.status !== 'exited'
  const mainDot = main && main.status !== 'off' ? main.status : 'exited'

  const items: QueueItem[] = queue?.items ?? []
  const count = (s: QueueItem['status']): number => items.filter((i) => i.status === s).length
  const nextItem = items.find((i) => i.status === 'queued')
  const queueState = queue?.pausedReason ? `Paused: ${queue.pausedReason}` : queue?.running ? 'Running' : 'Not running'

  const recent = ms.flatMap((m) => m.feed.map((e) => ({ e, m }))).sort((a, b) => b.e.at - a.e.at).slice(0, 12)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="repo-dashboard">
      <div className="mx-auto w-full max-w-3xl px-6 py-6">
        <header className="pb-4">
          <h2 className="text-base font-semibold tracking-tight">{name}</h2>
          <p className="mt-0.5 truncate font-mono text-[11px] text-faint" title={root}>{root}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {mainBranch && (
              <span className="inline-flex items-center gap-1 rounded border px-1.5 py-px font-mono text-[11px] text-muted-foreground" title="Merge to main targets this branch">
                <GitBranch className="size-3" />{mainBranch}
              </span>
            )}
            {orcBranch && (
              <span className="inline-flex items-center gap-1 rounded border px-1.5 py-px font-mono text-[11px] text-muted-foreground" title="ORC branch: integrated missions land here">
                <GitBranch className="size-3" />{orcBranch}
              </span>
            )}
          </div>
          {space?.gateCommand && (
            <p className="mt-2 text-[12px] text-muted-foreground">Gate: <span className="font-mono">{space.gateCommand}</span></p>
          )}
        </header>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-y py-2.5 text-[13px] text-muted-foreground" data-testid="dash-stats">
          {stats.map((s, i) => (
            <Fragment key={s.label}>
              {i > 0 && <span className="text-faint">·</span>}
              <span className={s.tone}>
                <span className="font-semibold tabular-nums text-foreground">{s.n}</span> {s.label}
              </span>
            </Fragment>
          ))}
        </div>

        <section className="border-b py-4" data-testid="dash-missions">
          <h3 className={sectionTitle}>Missions</h3>
          {ms.length === 0 ? (
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              No missions in this repo yet. Use the + on its row in the sidebar to start one.
            </p>
          ) : (
            <div className="-mx-1.5">
              {ms.map((m) => {
                const att = missionAttention(m)
                const live = m.agents.filter((a) => a.status !== 'done' && a.status !== 'exited').length
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onOpenMission(m.id)}
                    title={att.title || undefined}
                    className="flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-md px-1.5 py-1.5 text-left text-[13px] transition-colors hover:bg-accent"
                  >
                    <span className="flex w-2 shrink-0 justify-center">
                      {att.tier && <span className={cn('size-1.5 rounded-full', tierBg[att.tier])} />}
                    </span>
                    <span className={cn('min-w-0 flex-1 truncate font-medium', m.state === 'stopped' && !m.mergedToMain && 'text-muted-foreground line-through')}>{m.name}</span>
                    <span className="w-14 shrink-0 text-[11px] text-muted-foreground">{m.mergedToMain ? 'merged' : m.state}</span>
                    <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{live} live</span>
                    <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-faint">{m.tokens > 0 ? formatTokens(m.tokens) : ''}</span>
                    <span className="w-16 shrink-0 text-right text-[11px] text-faint">{ago(m.createdAt)}</span>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <section className="border-b py-4" data-testid="dash-main">
          <h3 className={sectionTitle}>Main session</h3>
          <div className="flex items-center gap-3">
            <Compass className="size-3.5 shrink-0 text-muted-foreground" />
            <StatusDot status={mainDot} />
            <span className="min-w-0 flex-1 truncate text-[13px]" data-testid="dash-main-activity">
              {main?.activity || (mainLive ? statusLabel[mainDot] : 'Not started')}
            </span>
            <Button size="sm" variant="outline" className="shrink-0 text-xs" data-testid="dash-open-main" onClick={onOpenMain}>
              {mainLive ? 'Open terminal' : <><Play /> Start main session</>}
            </Button>
          </div>
        </section>

        <section className="border-b py-4" data-testid="dash-backlog">
          <h3 className={sectionTitle}>Backlog</h3>
          {items.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">Backlog is empty.</p>
          ) : (
            <div className="space-y-1.5 text-[13px]">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
                <span className="text-foreground">{queueState}</span>
                <span className="text-faint">·</span>
                <span>{count('queued')} queued</span>
                <span className="text-faint">·</span>
                <span>{count('running')} running</span>
                <span className="text-faint">·</span>
                <span>{count('paused')} paused</span>
                <span className="text-faint">·</span>
                <span>{count('done')} done</span>
              </div>
              {nextItem && (
                <p className="truncate text-muted-foreground">Next: <span className="text-foreground">{nextItem.title}</span></p>
              )}
            </div>
          )}
        </section>

        <section className="py-4" data-testid="dash-activity">
          <h3 className={sectionTitle}>Recent activity</h3>
          {recent.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No activity yet.</p>
          ) : (
            <div className="-mx-1.5">
              {recent.map(({ e, m }) => (
                <button
                  key={`${m.id}:${e.id}`}
                  type="button"
                  onClick={() => onOpenMission(m.id)}
                  className="flex w-full min-w-0 cursor-pointer items-baseline gap-2 rounded px-1.5 py-1 text-left text-[12px] transition-colors hover:bg-accent"
                >
                  <span className="w-28 shrink-0 truncate text-muted-foreground">{m.name}</span>
                  <span className="shrink-0 font-mono text-[10.5px] text-faint">{e.kind}</span>
                  <span className="min-w-0 flex-1 truncate">{e.text}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-faint">{ago(e.at)}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

