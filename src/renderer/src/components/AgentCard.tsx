import { useState } from 'react'
import { motion } from 'motion/react'
import { CircleHelp, CheckCheck, GitMerge, Swords, Eye, Square, X } from 'lucide-react'
import type { AgentView, AgentStatus } from '../../../shared/types'
import { ago, cn, formatTokens } from '../lib/utils'
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
  starting: 'bg-faint',
  working: 'bg-working animate-orc-pulse',
  idle: 'bg-faint',
  'needs-you': 'bg-needs shadow-[0_0_0_3px] shadow-needs/20',
  done: 'bg-done',
  exited: 'bg-exited-foreground/60'
}

const labelClass: Record<AgentStatus, string> = {
  starting: 'text-muted-foreground',
  working: 'text-working',
  idle: 'text-muted-foreground',
  'needs-you': 'font-medium text-needs',
  done: 'text-done',
  exited: 'text-exited-foreground'
}

/** Card surface per status (when not selected): needs-you is loudest, done and exited recede. */
const cardClass: Record<AgentStatus, string> = {
  starting: 'hover:bg-accent',
  working: 'hover:bg-accent',
  idle: 'hover:bg-accent',
  'needs-you': 'hover:bg-accent',
  done: 'hover:bg-accent',
  exited: 'hover:bg-accent'
}

export function StatusDot({ status, crashed, className }: { status: AgentStatus; crashed?: boolean; className?: string }): React.JSX.Element {
  return <span className={cn('inline-block size-2 shrink-0 rounded-full', crashed ? 'bg-destructive' : dotClass[status], className)} />
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
  const crashed = a.exitKind === 'crashed'
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginTop: 0, paddingTop: 0, paddingBottom: 0 }}
      transition={{ duration: 0.18 }}
      data-testid="agent-card"
      data-agent={a.name}
      data-status={a.status}
      onClick={onSelect}
      className={cn(
        'group relative cursor-pointer rounded-md px-2 py-1 transition-colors',
        selected ? 'bg-selected' : cardClass[a.status]
      )}
    >
      {crashed && <span aria-hidden className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-destructive" />}
      {a.status === 'needs-you' && !selected && <span aria-hidden className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-needs" />}
      {/* Dimming sits on this wrapper: motion owns the root's inline opacity. */}
      <div className={cn('min-w-0 transition-opacity', !selected && !crashed && (a.status === 'done' || a.status === 'exited') && 'opacity-70 group-hover:opacity-100')}>
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot status={a.status} crashed={crashed} />
        <span className={cn('min-w-0 truncate text-[13px] font-medium', a.status === 'idle' || a.status === 'starting' ? 'text-muted-foreground' : 'text-foreground')}>{a.name}</span>
        <span className={cn('ml-auto shrink-0 text-[11px]', crashed ? 'font-medium text-destructive' : labelClass[a.status])} title={crashed ? `Its process exited with code ${a.exitCode}` : undefined}>{crashed ? 'crashed' : statusLabel[a.status]}</span>
        {onStop && !confirming && (
          <button
            data-testid="stop-worker"
            aria-label={`Stop ${a.name}`}
            title="Stop this worker"
            className={cn(
              'grid size-5 shrink-0 cursor-pointer place-items-center rounded text-faint opacity-0 transition-[opacity,color] hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none group-hover:opacity-100',
              selected && 'opacity-100'
            )}
            onClick={(e) => {
              e.stopPropagation()
              setConfirming(true)
            }}
          >
            <Square className="size-3.5" />
          </button>
        )}
        {onDismiss && (
          <button
            data-testid="dismiss-agent"
            aria-label={`Remove ${a.name}`}
            title="Remove this exited worker from the cards and tree. Its report, worktree and branch are kept."
            className="grid size-5 shrink-0 cursor-pointer place-items-center rounded text-faint hover:bg-destructive/10 hover:text-destructive focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
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
          className="mt-1.5 rounded-md border border-destructive/30 bg-muted px-2 py-1.5"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.key === 'Escape' && setConfirming(false)}
        >
          <div className="text-[12px] font-medium text-foreground">Stop {a.name}?</div>
          <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{stopConsequence(a)}</div>
          <div className="mt-1.5 flex justify-end gap-1.5">
            <Button size="xs" variant="ghost" autoFocus onClick={() => setConfirming(false)}>
              Keep running
            </Button>
            <Button
              size="xs"
              variant="destructive"
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
      {a.activity && <div className="truncate pl-4 font-mono text-[11px] text-muted-foreground" title={a.activity}>{a.activity}</div>}
      <div className="flex min-w-0 items-center gap-1 pl-4 text-[10.5px] text-faint">
        {a.branch && a.role === 'worker' && <span className="min-w-0 truncate" title={a.branch}>{a.branch.split('/').slice(-1)[0]}</span>}
        {a.branch && a.role === 'worker' && a.tokens > 0 && <span aria-hidden className="shrink-0">·</span>}
        {a.tokens > 0 && <span className="shrink-0 tabular-nums" title={`${a.tokens} tokens · context ${a.contextTokens}`}>{formatTokens(a.tokens)} tok</span>}
        {a.lastInstructionBy && (
          <span className="ml-auto hidden shrink-0 truncate group-hover:inline" data-testid="last-instruction" title="Last instruction sent to this agent">
            {a.lastInstructionBy === 'you' ? 'you' : a.lastInstructionBy}, {ago(a.lastInstructionAt)}
          </span>
        )}
      </div>
      {a.merge === 'merged' && (
        <div className="mt-0.5 flex items-center gap-1 pl-4 text-[11px] text-muted-foreground" data-testid="merge-state" data-merge="merged"><GitMerge className="size-3 shrink-0 text-working" /> merged into integration</div>
      )}
      {a.merge === 'conflict' && (
        <div className="mt-1.5 flex min-w-0 items-center gap-1 pl-4 text-[11px] text-destructive" data-testid="merge-state" data-merge="conflict" title={a.conflictFiles.join(', ')}><Swords className="size-3 shrink-0" /> <span className="truncate">conflict: {a.conflictFiles.join(', ')}</span></div>
      )}
      {a.merge === 'review' && (
        <button
          data-testid="review-worker"
          className="mt-1.5 ml-4 flex w-[calc(100%-1rem)] cursor-pointer items-center justify-center gap-1 rounded-md border border-needs/40 bg-needs/10 py-1 text-[12px] font-medium text-needs transition-colors hover:border-needs/60 hover:bg-needs/15 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
          onClick={(e) => {
            e.stopPropagation()
            onReview?.()
          }}
        >
          <Eye className="size-3.5" /> Review diff before it merges
        </button>
      )}
      {a.question && (
        <div className="mt-1.5 ml-4 flex min-w-0 gap-1.5 rounded-md bg-needs/10 px-2 py-1 text-[12px] leading-snug text-foreground">
          <CircleHelp className="mt-px size-3.5 shrink-0 text-needs" />
          <span className="min-w-0 break-words">{a.question}</span>
        </div>
      )}
      {a.doneSummary && (
        <div className="mt-1.5 flex min-w-0 gap-1.5 pl-4 text-[11.5px] text-muted-foreground">
          <CheckCheck className="mt-px size-3.5 shrink-0 text-done" />
          <span className="line-clamp-2">{a.doneSummary}</span>
        </div>
      )}
      </div>
    </motion.div>
  )
}
