import { useState } from 'react'
import { motion } from 'motion/react'
import { CircleHelp, GitBranch, CheckCheck, GitMerge, Swords, Eye, Square, X } from 'lucide-react'
import type { AgentView, AgentStatus } from '../../../shared/types'
import { ago, cn, formatTokens } from '../lib/utils'
import { Badge } from './ui/badge'
import { Button } from './ui/button'

/** What stopping this worker means for its work, in one line. */
function stopConsequence(a: AgentView): string {
  if (a.doneSummary && (a.merge === 'merged' || a.merge === 'nothing')) return 'Its work is merged. The session ends; its worktree and branch are kept.'
  if (a.merge === 'review') return 'Its diff still waits for your review: you can approve it, but no longer send it back.'
  if (a.merge === 'conflict') return "It was resolving a merge conflict. The conflict stays unresolved in its worktree and won't merge."
  if (a.doneSummary) return 'It reported done and its work still merges. The session ends.'
  return "It hasn't reported done. Its changes so far stay in its worktree but won't be committed or merged."
}

export const statusLabel: Record<AgentStatus, string> = {
  starting: 'starting',
  working: 'working',
  idle: 'idle',
  'needs-you': 'needs you',
  done: 'done',
  exited: 'exited'
}

const dotClass: Record<AgentStatus, string> = {
  starting: 'bg-muted-foreground/60',
  working: 'bg-working shadow-[0_0_8px_var(--color-working)] animate-orc-pulse',
  idle: 'bg-muted-foreground',
  'needs-you': 'bg-needs shadow-[0_0_8px_var(--color-needs)]',
  done: 'bg-done',
  exited: 'bg-exited'
}

export function StatusDot({ status, className }: { status: AgentStatus; className?: string }): React.JSX.Element {
  return <span className={cn('inline-block size-2 shrink-0 rounded-full', dotClass[status], className)} />
}

export function AgentCard({ a, selected, onSelect, onReview, onStop, onDismiss }: {
  a: AgentView
  selected: boolean
  onSelect: () => void
  onReview?: () => void
  /** Present when this worker can be stopped from its card. */
  onStop?: () => Promise<void>
  /** Present when this exited worker can be removed from the cards and tree. */
  onDismiss?: () => void
}): React.JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const [stopping, setStopping] = useState(false)
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginTop: 0, paddingTop: 0, paddingBottom: 0, borderWidth: 0 }}
      transition={{ duration: 0.18 }}
      data-testid="agent-card"
      data-agent={a.name}
      data-status={a.status}
      onClick={onSelect}
      className={cn(
        'group cursor-pointer rounded-lg border bg-card px-2.5 py-2 transition-colors hover:border-input',
        selected && 'border-primary/60 bg-accent',
        a.status === 'needs-you' && !selected && 'border-needs/40'
      )}
    >
      <div className="flex items-center gap-2">
        <StatusDot status={a.status} />
        <span className="truncate font-medium text-foreground">{a.name}</span>
        <Badge variant={a.status} className="ml-auto">{statusLabel[a.status]}</Badge>
        {onStop && !confirming && (
          <button
            data-testid="stop-worker"
            aria-label={`Stop ${a.name}`}
            title="Stop this worker"
            className={cn(
              'grid size-5 shrink-0 cursor-pointer place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100',
              selected && 'opacity-100'
            )}
            onClick={(e) => {
              e.stopPropagation()
              setConfirming(true)
            }}
          >
            <Square className="size-3" />
          </button>
        )}
        {onDismiss && (
          <button
            data-testid="dismiss-agent"
            aria-label={`Remove ${a.name}`}
            title="Remove this exited worker from the cards and tree. Its report, worktree and branch are kept."
            className="grid size-5 shrink-0 cursor-pointer place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation()
              onDismiss()
            }}
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {onStop && confirming && (
        <div
          data-testid="stop-worker-confirm"
          role="alertdialog"
          aria-label={`Stop ${a.name}?`}
          className="mt-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.key === 'Escape' && setConfirming(false)}
        >
          <div className="text-[12px] font-medium text-foreground">Stop {a.name}?</div>
          <div className="mt-0.5 text-[11.5px] text-muted-foreground">{stopConsequence(a)}</div>
          <div className="mt-1.5 flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" autoFocus onClick={() => setConfirming(false)}>
              Keep running
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="h-6 px-2 text-[11px]"
              data-testid="stop-worker-yes"
              disabled={stopping}
              onClick={() => {
                setStopping(true)
                // A refusal reaches the action-error banner; the card closes either way.
                void onStop().finally(() => {
                  setStopping(false)
                  setConfirming(false)
                })
              }}
            >
              <Square /> {stopping ? 'Stopping…' : 'Stop worker'}
            </Button>
          </div>
        </div>
      )}
      <div className="mt-1 truncate font-mono text-[11.5px] text-muted-foreground" title={a.activity}>{a.activity}</div>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
        {a.branch && a.role === 'worker' && (
          <span className="flex min-w-0 items-center gap-1 truncate" title={a.branch}>
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate">{a.branch.split('/').slice(-1)[0]}</span>
          </span>
        )}
        {a.tokens > 0 && <span className="ml-auto shrink-0 tabular-nums" title={`${a.tokens} tokens · context ${a.contextTokens}`}>{formatTokens(a.tokens)} tok</span>}
      </div>
      {a.lastInstructionBy && (
        <div className="mt-0.5 text-[11px] text-muted-foreground" data-testid="last-instruction">
          last instruction: <span className={a.lastInstructionBy === 'you' ? 'text-foreground' : ''}>{a.lastInstructionBy}</span>, {ago(a.lastInstructionAt)}
        </div>
      )}
      {a.merge === 'merged' && (
        <div className="mt-1 flex items-center gap-1 text-[11px] text-working" data-testid="merge-state" data-merge="merged"><GitMerge className="size-3" /> merged into integration</div>
      )}
      {a.merge === 'conflict' && (
        <div className="mt-1 flex items-center gap-1 text-[11px] text-destructive" data-testid="merge-state" data-merge="conflict" title={a.conflictFiles.join(', ')}><Swords className="size-3" /> conflict: {a.conflictFiles.join(', ')}</div>
      )}
      {a.merge === 'review' && (
        <button
          data-testid="review-worker"
          className="mt-1.5 flex w-full cursor-pointer items-center justify-center gap-1 rounded-md border border-needs/40 bg-needs/10 py-1 text-[12px] text-needs hover:bg-needs/20"
          onClick={(e) => {
            e.stopPropagation()
            onReview?.()
          }}
        >
          <Eye className="size-3.5" /> Review diff before it merges
        </button>
      )}
      {a.question && (
        <div className="mt-1.5 flex gap-1.5 rounded-md bg-needs/10 px-2 py-1 text-[12px] text-needs">
          <CircleHelp className="mt-0.5 size-3.5 shrink-0" />
          <span>{a.question}</span>
        </div>
      )}
      {a.doneSummary && (
        <div className="mt-1.5 flex gap-1.5 text-[11.5px] text-done/90">
          <CheckCheck className="mt-0.5 size-3.5 shrink-0" />
          <span className="line-clamp-2">{a.doneSummary}</span>
        </div>
      )}
    </motion.div>
  )
}
