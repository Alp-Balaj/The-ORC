import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowLeft, Bot, Check, CheckCircle2, CircleDashed, GitMerge, ListChecks, Loader2, Play, ShieldCheck, Undo2, X, XCircle } from 'lucide-react'
import type { DiffView as Diff, MissionView, SpaceView } from '../../../shared/types'
import { cn } from '../lib/utils'
import { emitShortcut } from '../lib/shortcuts'
import { DiffView } from './DiffView'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'

/** Plan check: the coordinator's proposed split, waiting for the human. */
export function SplitPanel({ mission }: { mission: MissionView }): React.JSX.Element | null {
  const [note, setNote] = useState('')
  const s = mission.split
  if (!s || s.status !== 'pending') return null
  return (
    <div className="border-b border-needs/30 bg-needs/5 px-4 py-3" data-testid="split-panel">
      <div className="flex items-center gap-2 text-[13px] font-semibold">
        <ListChecks className="size-4 shrink-0 text-needs" />
        The coordinator proposes a split
        <span className="font-normal text-muted-foreground">· {s.workers.length} worker{s.workers.length === 1 ? '' : 's'}</span>
      </div>
      {s.summary && <p className="mt-1 pl-6 text-[12.5px] leading-relaxed text-muted-foreground">{s.summary}</p>}
      <ul className="mt-2.5 grid gap-2 pl-6 sm:grid-cols-2 min-[1440px]:grid-cols-3">
        {s.workers.map((w) => (
          <li key={w.name} className="rounded-lg border border-border bg-card px-3 py-2 transition-colors hover:border-border-strong">
            <div className="text-[12.5px] font-medium text-foreground">{w.name}</div>
            <div className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted-foreground" title={w.task}>{w.task}</div>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center gap-1.5 pl-6">
        <Input placeholder="Note for the coordinator (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="max-w-md flex-1" data-testid="split-note" />
        <Button size="sm" variant="ghost-destructive" onClick={() => void window.orc.decideSplit(mission.id, false, note || null)} data-testid="reject-split"><X /> Reject</Button>
        <Button size="sm" onClick={() => void window.orc.decideSplit(mission.id, true, note || null)} data-testid="approve-split"><Check /> Approve</Button>
      </div>
    </div>
  )
}

function useDiff(load: () => Promise<Diff | null>, deps: unknown[]): Diff | null {
  const [diff, setDiff] = useState<Diff | null>(null)
  useEffect(() => {
    let live = true
    void load().then((d) => live && setDiff(d))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return diff
}

function DiffArea({ diff, empty }: { diff: Diff | null; empty: string }): React.JSX.Element {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {diff ? <DiffView diff={diff} /> : <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border-strong text-[13px] text-faint">{empty}</div>}
    </div>
  )
}

function DiffStats({ diff }: { diff: Diff | null }): React.JSX.Element | null {
  if (!diff) return null
  const added = diff.files.reduce((n, f) => n + f.added, 0)
  const removed = diff.files.reduce((n, f) => n + f.removed, 0)
  return (
    <div className="text-[12px] text-muted-foreground tabular-nums">
      {diff.files.length} file{diff.files.length === 1 ? '' : 's'} · <span className="text-working">+{added}</span> <span className="text-destructive">−{removed}</span> · {diff.commits} commit{diff.commits === 1 ? '' : 's'}
    </div>
  )
}

/** Checkpointed: one worker's diff, approve or send back. */
export function ReviewScreen({ mission, agent, onBack }: { mission: MissionView; agent: string; onBack: () => void }): React.JSX.Element {
  const a = mission.agents.find((x) => x.name === agent)
  const diff = useDiff(() => window.orc.workerDiff(mission.id, agent), [mission.id, agent, a?.merge])
  const [note, setNote] = useState('')
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" data-testid="review-screen">
      <div className="flex items-start gap-2 px-4 pt-3 pb-2.5">
        <Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft /> Terminal</Button>
        <div className="min-w-0 flex-1 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold">Review {agent}</span>
            {a?.branch && <Badge variant="outline">{a.branch}</Badge>}
          </div>
          {a?.doneSummary && <p className="mt-1 line-clamp-2 max-w-3xl text-[12.5px] leading-relaxed text-muted-foreground" title={a.doneSummary}>{a.doneSummary}</p>}
          <div className="mt-1"><DiffStats diff={diff} /></div>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-3">
        <DiffArea diff={diff} empty="Loading diff…" />
      </div>
      {a?.merge === 'review' ? (
        <div className="flex items-center gap-2 border-t border-border bg-background px-4 py-2.5">
          {a.status === 'exited' ? (
            <span className="text-[12px] text-muted-foreground">{agent} was stopped, so it can't be sent back.</span>
          ) : (
            <>
              <Input placeholder="What should change?" value={note} onChange={(e) => setNote(e.target.value)} className="max-w-md flex-1" />
              <Button variant="outline" disabled={!note.trim()} onClick={() => void window.orc.sendBack(mission.id, agent, note).then(onBack)}><Undo2 /> Send back</Button>
            </>
          )}
          <Button className="ml-auto" onClick={() => void window.orc.approveWorker(mission.id, agent).then(onBack)} data-testid="approve-worker"><GitMerge /> Approve and merge into integration</Button>
        </div>
      ) : (
        <div className="border-t border-border bg-background px-4 py-2.5 text-[12px] text-faint">State: {a?.merge ?? 'not reported yet'}</div>
      )}
    </div>
  )
}

function StatusIcon({ state }: { state: 'pass' | 'fail' | 'warn' | 'running' | 'idle' }): React.JSX.Element {
  if (state === 'pass') return <CheckCircle2 className="size-4 shrink-0 text-working" />
  if (state === 'fail') return <XCircle className="size-4 shrink-0 text-destructive" />
  if (state === 'warn') return <AlertTriangle className="size-4 shrink-0 text-needs" />
  if (state === 'running') return <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
  return <CircleDashed className="size-4 shrink-0 text-faint" />
}

function StaleNote({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="mt-1.5 flex items-center gap-1 text-[11px] text-needs"><AlertTriangle className="size-3" /> {children}</div>
}

/** The ORC branch's name in git (mission-git.ts OrcBranch). */
export const OrcBranch = 'orc-integration'

/** Integrate: the mission's combined diff, the gate, the Verifier, and the button that merges it
 *  into the repo's ORC branch. Merge to main (OrcMergeScreen) later brings the ORC branch to main. */
export function MergeScreen({ mission, space, onBack, onRemoved }: { mission: MissionView; space: SpaceView | undefined; onBack: () => void; onRemoved?: () => void }): React.JSX.Element {
  const diff = useDiff(() => window.orc.missionDiff(mission.id), [mission.id, mission.integrationCommit])
  const [gateCmd, setGateCmd] = useState(space?.gateCommand ?? '')
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => setGateCmd(space?.gateCommand ?? ''), [space?.gateCommand])

  const v = mission.verifier
  const stale = v && v.integrationCommit !== mission.integrationCommit
  const gateStale = mission.gate && mission.gate.output !== 'running…' && mission.integrationCommit && mission.gate.at < (mission.feed.findLast((f) => f.kind === 'merge')?.at ?? 0)

  const gateRunning = mission.gate?.output === 'running…'
  const gateState = !mission.gate ? 'idle' : gateRunning ? 'running' : mission.gate.ok ? 'pass' : 'fail'
  const gateText = !mission.gate ? (space?.gateCommand ? 'not run' : 'none configured') : gateRunning ? 'running' : mission.gate.ok ? 'passed' : `failed (exit ${mission.gate.exitCode})`
  const verdict = v ? (/VERDICT:\s*(\w+)/.exec(v.report)?.[1] ?? v.status) : null
  const verifierPass = !!v && /VERDICT:\s*PASS/.test(v.report)
  const verifierState = !v ? 'idle' : v.status === 'running' ? 'running' : verifierPass ? 'pass' : 'warn'
  const unmerged = mission.agents.filter((a) => a.role === 'worker' && a.merge !== 'merged')
  const integrated = !!mission.integrated && mission.integrated.integrationCommit === mission.integrationCommit
  const newSince = !!mission.integrated && !integrated
  const conflictState = mission.merged.length === 0 ? 'idle' : mission.integrateError && !integrated ? 'fail' : unmerged.length ? 'warn' : 'pass'
  const conflictText = mission.merged.length === 0 ? 'nothing merged yet' : mission.integrateError && !integrated ? `with the ORC branch: ${mission.integrateError.files.join(', ') || 'see below'}` : unmerged.length ? `${unmerged.length} worker${unmerged.length === 1 ? '' : 's'} not merged` : 'none'

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" data-testid="merge-screen">
      <div className="flex items-start gap-2 px-4 pt-3 pb-2.5">
        <Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft /> Terminal</Button>
        <div className="min-w-0 flex-1 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold">Integrate {mission.name} into the ORC branch</span>
            <Badge variant="outline">integration/{mission.name}</Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <DiffStats diff={diff} />
            <span className="truncate text-[12px] text-muted-foreground">{mission.merged.length} worker{mission.merged.length === 1 ? '' : 's'} merged: {mission.merged.join(', ') || 'none yet'}</span>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3 px-4 pb-4">
        {mission.mergedToMain ? (
          <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card p-6 text-center" data-testid="merged-success">
            <CheckCircle2 className="size-10 text-working" />
            <div className="text-[16px] font-semibold">Merged to {mission.mainBranch}</div>
            <div className="font-mono text-[12px] text-muted-foreground" title={mission.mergedToMain.commit}>{mission.mergedToMain.commit.slice(0, 8)}</div>
            <div className="mt-3 flex gap-2">
              <Button variant="outline" onClick={() => void window.orc.removeMission(mission.id).then(() => onRemoved?.())} data-testid="merged-remove-mission">Remove mission</Button>
              <Button onClick={() => emitShortcut('newMission')} data-testid="merged-new-mission">New mission</Button>
            </div>
          </div>
        ) : (
          <DiffArea diff={diff} empty="Nothing merged yet." />
        )}

        <aside className="flex w-[260px] shrink-0 flex-col gap-3 overflow-y-auto min-[1440px]:w-[310px]">
          <section className="rounded-lg border border-ring/40 bg-card p-3" data-testid="verdict-panel">
            <ul className="space-y-1.5 text-[12.5px]">
              <li className="flex items-center gap-2"><StatusIcon state={gateState} /><span className="w-[68px] shrink-0 text-muted-foreground">Gate</span><span className="min-w-0 truncate">{gateText}{gateStale ? ' (stale)' : ''}</span></li>
              <li className="flex items-center gap-2"><StatusIcon state={verifierState} /><span className="w-[68px] shrink-0 text-muted-foreground">Verifier</span><span className="min-w-0 truncate">{v ? (v.status === 'running' ? 'running' : verdict) : 'not run'}{v && stale ? ' (stale)' : ''}</span></li>
              <li className="flex items-center gap-2"><StatusIcon state={conflictState} /><span className="w-[68px] shrink-0 text-muted-foreground">Conflicts</span><span className="min-w-0 truncate">{conflictText}</span></li>
            </ul>
            {!mission.mergedToMain && (
              <Button
                className="mt-3 w-full"
                disabled={busy || mission.merged.length === 0 || integrated}
                onClick={async () => {
                  setBusy(true)
                  setResult(await window.orc.integrate(mission.id))
                  setBusy(false)
                }}
                data-testid="confirm-merge"
              >
                {busy ? <Loader2 className="animate-spin" /> : <GitMerge />} {integrated ? 'Integrated' : newSince ? 'Integrate new work' : 'Integrate'}
              </Button>
            )}
            <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
              Merges this mission into <span className="font-mono">{OrcBranch}</span>, where every mission's work collects. The mission keeps running. Merge to main in the header then brings the ORC branch into {mission.mainBranch}.
            </p>
            {unmerged.length > 0 && (
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-needs" data-testid="unmerged-warning">Not merged into the mission yet, so not integrated: {unmerged.map((a) => a.name).join(', ')}.</p>
            )}
            {newSince && !result && (
              <p className="mt-1.5 text-[12px] text-needs" data-testid="integrate-stale">Work merged since the last integration is not on the ORC branch yet.</p>
            )}
            {(result || integrated || mission.integrateError) && (
              <p className={cn('mt-1.5 text-[12px]', (result ? !result.ok : !integrated && !!mission.integrateError) ? 'text-destructive' : 'text-working')} data-testid="merge-result">
                {result?.message ?? (integrated ? `On the ORC branch at ${mission.integrated!.commit.slice(0, 8)}.` : mission.integrateError!.message)}
              </p>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-3" data-testid="gate-panel">
            <div className="flex items-center gap-2">
              <StatusIcon state={gateState} />
              <ShieldCheck className="size-3.5 text-faint" />
              <span className="text-[13px] font-medium">Gate</span>
              {mission.gate && (
                <Badge className="ml-auto" variant={gateRunning ? 'idle' : mission.gate.ok ? 'working' : 'exited'} data-testid="gate-result">
                  {gateRunning ? 'running' : mission.gate.ok ? 'passed' : `failed (exit ${mission.gate.exitCode})`}
                </Badge>
              )}
            </div>
            {gateStale && <StaleNote>Older than the latest merge</StaleNote>}
            <div className="mt-2.5 flex gap-1.5">
              <Input placeholder="e.g. pnpm test" title="Runs in the merged result" value={gateCmd} onChange={(e) => setGateCmd(e.target.value)} className="h-8 min-w-0 flex-1 text-ellipsis font-mono text-[12px]" data-testid="gate-command" />
              <Button size="sm" variant="outline" className="shrink-0" onClick={() => space && void window.orc.setGateCommand(space.root, gateCmd || null)} disabled={!space || gateCmd === (space?.gateCommand ?? '')}>Save</Button>
              <Button size="sm" variant="outline" className="shrink-0" disabled={!space?.gateCommand || mission.merged.length === 0} onClick={() => void window.orc.runGate(mission.id)} data-testid="run-gate"><Play /> Run</Button>
            </div>
            {mission.gate ? (
              <pre className="mt-2 max-h-32 overflow-auto rounded-md border border-border bg-panel p-2 font-mono text-[12px] text-muted-foreground">{mission.gate.output || '(no output)'}</pre>
            ) : (
              <div className="mt-2 text-[12px] text-muted-foreground">{space?.gateCommand ? 'Not run yet.' : 'No gate configured for this space. Merging is still allowed.'}</div>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-3" data-testid="verifier-panel">
            <div className="flex items-center gap-2">
              <StatusIcon state={verifierState} />
              <Bot className="size-3.5 shrink-0 text-faint max-[1439px]:hidden" />
              <span className="min-w-0 truncate text-[13px] font-medium">Verifier</span>
              <div className="ml-auto flex items-center gap-1.5">
                {v && (
                  <Badge variant={v.status === 'running' ? 'idle' : verifierPass ? 'working' : 'needs-you'} data-testid="verifier-status">
                    {v.status === 'running' ? 'running…' : verdict}
                  </Badge>
                )}
                <Button size="sm" variant="outline" disabled={v?.status === 'running' || mission.merged.length === 0} onClick={() => void window.orc.runVerifier(mission.id)} data-testid="run-verifier">
                  <Play /> {v ? 'Run again' : 'Run'}
                </Button>
              </div>
            </div>
            {v ? (
              <>
                {stale && <StaleNote>About an older integration commit</StaleNote>}
                {v.report && <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-panel p-2 text-[12px] leading-relaxed text-foreground" data-testid="verifier-report">{v.report}</pre>}
                <div className="mt-1.5 truncate font-mono text-[10px] text-faint" title="sha256 of the pinned template / of the full prompt">template {v.templateHash.slice(0, 12)} · prompt {v.promptHash.slice(0, 12)}</div>
              </>
            ) : (
              <div className="mt-2 text-[12px] leading-relaxed text-muted-foreground">A one-shot, read-only Claude run that checks the combined diff against the brief and the split. It runs on its own once every team is merged.</div>
            )}
          </section>

        </aside>
      </div>
    </div>
  )
}

/** Merge to main: everything on the repo's ORC branch, and the missions it holds. */
export function OrcMergeScreen({ repo, missions, onBack, onCleared }: { repo: string; missions: MissionView[]; onBack: () => void; onCleared?: (n: number) => void }): React.JSX.Element {
  const inRepo = missions.filter((m) => m.repoPath === repo && !m.mergedToMain)
  const ready = inRepo.filter((m) => m.integrated && m.integrated.integrationCommit === m.integrationCommit)
  const pending = inRepo.filter((m) => m.merged.length > 0 && !ready.includes(m))
  const main = ready[0]?.mainBranch ?? inRepo[0]?.mainBranch ?? 'main'
  const diff = useDiff(() => window.orc.orcDiff(repo), [repo, ready.map((m) => m.integrated!.commit).join()])
  const [result, setResult] = useState<{ ok: boolean; message: string; files?: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const nothing = !!diff && diff.files.length === 0 && diff.commits === 0

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" data-testid="orc-merge-screen">
      <div className="flex items-start gap-2 px-4 pt-3 pb-2.5">
        <Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft /> Terminal</Button>
        <div className="min-w-0 flex-1 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold">Merge the ORC branch into {main}</span>
            <Badge variant="outline">{OrcBranch}</Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <DiffStats diff={diff} />
            <span className="truncate text-[12px] text-muted-foreground">{ready.length} mission{ready.length === 1 ? '' : 's'} integrated</span>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3 px-4 pb-4">
        <DiffArea diff={diff} empty={`Nothing on ${OrcBranch} that isn't in ${main}. Integrate a mission first.`} />

        <aside className="flex w-[260px] shrink-0 flex-col gap-3 overflow-y-auto min-[1440px]:w-[310px]">
          <section className="rounded-lg border border-border bg-card p-3" data-testid="orc-missions">
            <div className="text-[13px] font-medium">On the ORC branch</div>
            {ready.length === 0 ? (
              <p className="mt-2 text-[12px] text-muted-foreground">No mission integrated yet. Open a mission's Integrate screen, or let the queue integrate missions as their Verifier passes.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-[12px]">
                {ready.map((m) => (
                  <li key={m.id} className="flex items-center gap-2"><StatusIcon state="pass" /><span className="min-w-0 truncate" title={m.name}>{m.name}</span></li>
                ))}
              </ul>
            )}
            {pending.length > 0 && (
              <>
                <div className="mt-3 text-[12px] text-muted-foreground">Not integrated (stay out of {main}):</div>
                <ul className="mt-1 space-y-1 text-[12px]">
                  {pending.map((m) => (
                    <li key={m.id} className="flex items-center gap-2" title={m.integrateError?.message}>
                      <StatusIcon state={m.integrateError ? 'fail' : m.integrated ? 'warn' : 'idle'} />
                      <span className="min-w-0 truncate">{m.name}</span>
                      <span className="ml-auto shrink-0 text-faint">{m.integrateError ? 'conflict' : m.integrated ? 'new work' : ''}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="rounded-lg border border-ring/40 bg-card p-3">
            <div className="flex items-center gap-2 text-[13px] font-medium"><GitMerge className="size-4 text-faint" /> Merge to {main}</div>
            <Button
              className="mt-3 w-full"
              disabled={busy || nothing}
              onClick={async () => {
                setBusy(true)
                const r = await window.orc.mergeToMain(repo)
                setResult(r)
                setBusy(false)
                // The merged missions are cleared out of the list.
                if (r.ok) onCleared?.(r.cleared ?? 0)
              }}
              data-testid="confirm-main-merge"
            >
              {busy ? <Loader2 className="animate-spin" /> : <GitMerge />} Merge to {main}
            </Button>
            <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
              Brings {OrcBranch} into your checkout of {main}. If {main} has new commits, they are merged into the ORC branch first. Ends the integrated missions and removes their worktrees.
            </p>
            {result && (
              <p className={cn('mt-1.5 text-[12px]', result.ok ? 'text-working' : 'text-destructive')} data-testid="main-merge-result">{result.message}</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}
