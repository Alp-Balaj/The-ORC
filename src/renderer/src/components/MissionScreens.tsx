import { useEffect, useState } from 'react'
import { ArrowLeft, Bot, Check, GitMerge, ListChecks, Play, ShieldCheck, Undo2, X } from 'lucide-react'
import type { DiffView as Diff, MissionView, SpaceView } from '../../../shared/types'
import { cn } from '../lib/utils'
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
      <div className="flex items-center gap-2 text-[13px]">
        <ListChecks className="size-4 text-needs" />
        <span className="font-semibold">The coordinator proposes a split</span>
        <span className="text-muted-foreground">· {s.summary}</span>
      </div>
      <ul className="mt-2 grid gap-1 sm:grid-cols-2">
        {s.workers.map((w) => (
          <li key={w.name} className="rounded-md border bg-card px-2.5 py-1.5 text-[12px]">
            <span className="font-medium">{w.name}</span>
            <span className="text-muted-foreground"> — {w.task}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-1.5">
        <Input placeholder="Note for the coordinator (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="max-w-md" data-testid="split-note" />
        <Button size="sm" onClick={() => void window.orc.decideSplit(mission.id, true, note || null)} data-testid="approve-split"><Check /> Approve</Button>
        <Button size="sm" variant="destructive" onClick={() => void window.orc.decideSplit(mission.id, false, note || null)} data-testid="reject-split"><X /> Reject</Button>
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

/** Checkpointed: one worker's diff, approve or send back. */
export function ReviewScreen({ mission, agent, onBack }: { mission: MissionView; agent: string; onBack: () => void }): React.JSX.Element {
  const a = mission.agents.find((x) => x.name === agent)
  const diff = useDiff(() => window.orc.workerDiff(mission.id, agent), [mission.id, agent, a?.merge])
  const [note, setNote] = useState('')
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4" data-testid="review-screen">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft /> Terminal</Button>
        <span className="font-semibold">Review {agent}</span>
        {a?.branch && <Badge variant="outline">{a.branch}</Badge>}
        {a?.doneSummary && <span className="truncate text-[12px] text-muted-foreground">{a.doneSummary}</span>}
      </div>
      {diff ? <DiffView diff={diff} /> : <div className="text-muted-foreground">Loading diff…</div>}
      {a?.merge === 'review' ? (
        <div className="flex gap-1.5">
          <Button onClick={() => void window.orc.approveWorker(mission.id, agent).then(onBack)} data-testid="approve-worker"><GitMerge /> Approve and merge into integration</Button>
          <Input placeholder="What should change?" value={note} onChange={(e) => setNote(e.target.value)} className="max-w-md" />
          <Button variant="outline" disabled={!note.trim()} onClick={() => void window.orc.sendBack(mission.id, agent, note).then(onBack)}><Undo2 /> Send back</Button>
        </div>
      ) : (
        <div className="text-[12px] text-muted-foreground">State: {a?.merge ?? 'not reported yet'}</div>
      )}
    </div>
  )
}

/** Merge to main: the mission's combined diff, the gate, the Verifier, and the button. */
export function MergeScreen({ mission, space, onBack }: { mission: MissionView; space: SpaceView | undefined; onBack: () => void }): React.JSX.Element {
  const diff = useDiff(() => window.orc.missionDiff(mission.id), [mission.id, mission.integrationCommit])
  const [gateCmd, setGateCmd] = useState(space?.gateCommand ?? '')
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => setGateCmd(space?.gateCommand ?? ''), [space?.gateCommand])

  const v = mission.verifier
  const stale = v && v.integrationCommit !== mission.integrationCommit
  const gateStale = mission.gate && mission.gate.output !== 'running…' && mission.integrationCommit && mission.gate.at < (mission.feed.findLast((f) => f.kind === 'merge')?.at ?? 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4" data-testid="merge-screen">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft /> Terminal</Button>
        <span className="font-semibold">Merge {mission.name} into {mission.baseBranch}</span>
        <Badge variant="outline">integration/{mission.name}</Badge>
        <span className="text-[12px] text-muted-foreground">{mission.merged.length} worker{mission.merged.length === 1 ? '' : 's'} merged: {mission.merged.join(', ') || 'none yet'}</span>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-lg border bg-card p-3" data-testid="gate-panel">
          <div className="mb-2 flex items-center gap-1.5 font-medium"><ShieldCheck className="size-4" /> Gate</div>
          <div className="flex gap-1.5">
            <Input placeholder="e.g. pnpm test (runs in the merged result)" value={gateCmd} onChange={(e) => setGateCmd(e.target.value)} data-testid="gate-command" />
            <Button size="sm" variant="outline" onClick={() => space && void window.orc.setGateCommand(space.root, gateCmd || null)} disabled={!space || gateCmd === (space?.gateCommand ?? '')}>Save</Button>
            <Button size="sm" variant="outline" disabled={!space?.gateCommand || mission.merged.length === 0} onClick={() => void window.orc.runGate(mission.id)} data-testid="run-gate"><Play /> Run</Button>
          </div>
          {mission.gate ? (
            <div className="mt-2">
              <Badge variant={mission.gate.output === 'running…' ? 'idle' : mission.gate.ok ? 'working' : 'exited'} data-testid="gate-result">
                {mission.gate.output === 'running…' ? 'running' : mission.gate.ok ? 'passed' : `failed (exit ${mission.gate.exitCode})`}
              </Badge>
              {gateStale && <Badge variant="needs-you" className="ml-1">older than the latest merge</Badge>}
              <pre className="mt-1.5 max-h-40 overflow-auto rounded-md bg-background p-2 font-mono text-[11px] text-muted-foreground">{mission.gate.output || '(no output)'}</pre>
            </div>
          ) : (
            <div className="mt-2 text-[12px] text-muted-foreground">{space?.gateCommand ? 'Not run yet.' : 'No gate configured for this space. Merging is still allowed.'}</div>
          )}
        </section>

        <section className="rounded-lg border bg-card p-3" data-testid="verifier-panel">
          <div className="mb-2 flex items-center gap-1.5 font-medium">
            <Bot className="size-4" /> Verifier
            <Button size="sm" variant="outline" className="ml-auto" disabled={v?.status === 'running' || mission.merged.length === 0} onClick={() => void window.orc.runVerifier(mission.id)} data-testid="run-verifier">
              <Play /> {v ? 'Run again' : 'Run'}
            </Button>
          </div>
          {v ? (
            <>
              <div className="flex flex-wrap gap-1">
                <Badge variant={v.status === 'running' ? 'idle' : /VERDICT:\s*PASS/.test(v.report) ? 'working' : 'needs-you'} data-testid="verifier-status">
                  {v.status === 'running' ? 'running…' : (/VERDICT:\s*(\w+)/.exec(v.report)?.[1] ?? v.status)}
                </Badge>
                {stale && <Badge variant="needs-you">about an older integration commit</Badge>}
              </div>
              {v.report && <pre className="mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-background p-2 text-[12px]" data-testid="verifier-report">{v.report}</pre>}
              <div className="mt-1 font-mono text-[10px] text-muted-foreground" title="sha256 of the pinned template / of the full prompt">template {v.templateHash.slice(0, 12)} · prompt {v.promptHash.slice(0, 12)}</div>
            </>
          ) : (
            <div className="text-[12px] text-muted-foreground">A one-shot, read-only Claude run that checks the combined diff against the brief and the split.</div>
          )}
        </section>
      </div>

      <div className="flex min-h-[260px] flex-1 flex-col">{diff ? <DiffView diff={diff} /> : <div className="text-muted-foreground">Nothing merged yet.</div>}</div>

      <div className="flex items-center gap-3 border-t pt-3">
        <Button
          disabled={busy || mission.merged.length === 0 || !!mission.mergedToMain}
          onClick={async () => {
            setBusy(true)
            setResult(await window.orc.mergeToMain(mission.id))
            setBusy(false)
          }}
          data-testid="confirm-merge"
        >
          <GitMerge /> Merge to {mission.baseBranch}
        </Button>
        <span className="text-[12px] text-muted-foreground">Fast-forward only. Ends the mission's sessions and removes its worktrees and branches.</span>
        {(result || mission.mergedToMain) && (
          <span className={cn('text-[12px]', result && !result.ok ? 'text-destructive' : 'text-working')} data-testid="merge-result">
            {result?.message ?? `Merged at ${mission.mergedToMain!.commit.slice(0, 8)}.`}
          </span>
        )}
      </div>
    </div>
  )
}
