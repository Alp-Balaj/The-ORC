import { memo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Bot, CheckCheck, CircleHelp, GitCommitHorizontal, GitFork, GitMerge, GitPullRequestArrow, Inbox, Keyboard, ListChecks, OctagonX, Send, ShieldCheck, Swords, TriangleAlert } from 'lucide-react'
import type { FeedEntry } from '../../../shared/types'
import { cn } from '../lib/utils'

const icon = (f: FeedEntry): React.JSX.Element => {
  const c = 'size-3.5 shrink-0'
  switch (f.kind) {
    case 'spawn': return <GitFork className={cn(c, 'text-working')} />
    case 'message': return f.status === 'failed' ? <TriangleAlert className={cn(c, 'text-destructive')} /> : <Send className={cn(c, 'text-done')} />
    case 'delivered': return <Inbox className={cn(c, 'text-done')} />
    case 'done': return <CheckCheck className={cn(c, 'text-done')} />
    case 'question': return <CircleHelp className={cn(c, 'text-needs')} />
    case 'steer': return <Keyboard className={cn(c, 'text-foreground')} />
    case 'stopped': return <OctagonX className={cn(c, 'text-destructive')} />
    case 'split': return <ListChecks className={cn(c, f.status === 'failed' ? 'text-destructive' : 'text-needs')} />
    case 'commit': return <GitCommitHorizontal className={cn(c, 'text-muted-foreground')} />
    case 'merge': return <GitMerge className={cn(c, 'text-working')} />
    case 'conflict': return <Swords className={cn(c, 'text-destructive')} />
    case 'gate': return <ShieldCheck className={cn(c, f.status === 'ok' ? 'text-working' : 'text-destructive')} />
    case 'verifier': return <Bot className={cn(c, f.status === 'ok' ? 'text-working' : 'text-needs')} />
    case 'main': return <GitPullRequestArrow className={cn(c, f.status === 'ok' ? 'text-done' : 'text-destructive')} />
    case 'orc': return <Bot className={cn(c, f.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')} />
  }
}

const verb: Record<FeedEntry['kind'], string> = {
  spawn: 'spawned',
  message: 'messaged',
  delivered: 'reached',
  done: 'reported done to',
  question: 'asks',
  steer: 'typed to',
  stopped: 'stopped the mission',
  split: 'split',
  commit: 'committed',
  merge: 'merged',
  conflict: 'conflict',
  gate: 'gate',
  verifier: 'verifier',
  main: 'merge to main',
  orc: 'the ORC'
}

type Tone = 'attention' | 'amber' | 'routine' | 'milestone'

/** attention/amber: needs the owner's eye; routine: chatter; milestone: progress. */
const tone = (f: FeedEntry): Tone => {
  switch (f.kind) {
    case 'question': return 'amber'
    case 'verifier': return f.status === 'ok' ? 'milestone' : 'amber'
    case 'stopped':
    case 'conflict': return 'attention'
    case 'gate':
    case 'main': return f.status === 'ok' ? 'milestone' : 'attention'
    case 'orc':
    case 'split': return f.status === 'failed' ? 'attention' : 'milestone'
    case 'message': return f.status === 'failed' ? 'attention' : 'routine'
    case 'delivered':
    case 'commit':
    case 'steer':
    case 'spawn': return 'routine'
    default: return 'milestone'
  }
}

const fullTime = (t: number): string => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const shortTime = (t: number): string => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

const GROUP_MS = 2 * 60_000
const GAP_MS = 10 * 60_000

function FeedView({ feed }: { feed: FeedEntry[] }): React.JSX.Element {
  const items = [...feed].reverse().slice(0, 80)
  if (items.length === 0) {
    return <div className="px-3 py-4 text-[12px] text-faint">Spawns, messages and reports appear here.</div>
  }
  const rows: React.JSX.Element[] = []
  items.forEach((f, i) => {
    const prev = i > 0 ? items[i - 1] : null
    const gap = prev ? Math.abs(prev.at - f.at) : 0
    if (prev && gap > GAP_MS) {
      rows.push(
        <li key={`gap-${f.id}`} aria-hidden className="flex items-center gap-2 px-1.5 pb-0.5 pt-2.5">
          <span className="text-[10px] tabular-nums text-faint">{shortTime(prev.at)}</span>
          <span className="h-px flex-1 bg-border" />
        </li>
      )
    }
    const grouped = !!prev && prev.from === f.from && gap <= GROUP_MS
    const t = tone(f)
    const flagged = t === 'attention' || t === 'amber'
    const routine = t === 'routine'
    rows.push(
      <motion.li
        key={f.id}
        layout
        initial={{ opacity: 0, x: -6 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.15 }}
        data-testid="feed-entry"
        data-kind={f.kind}
        data-status={f.status ?? ''}
        className={cn(
          'rounded-md px-1.5 pb-1 transition-colors hover:bg-accent',
          grouped ? 'pt-0' : 'pt-1',
          t === 'attention' && 'my-0.5 rounded-l-sm border-l-2 border-destructive bg-destructive/5 pt-1 hover:bg-destructive/10',
          t === 'amber' && 'my-0.5 rounded-l-sm border-l-2 border-needs bg-needs/10 pt-1 hover:bg-needs/15'
        )}
      >
        <div className={cn('flex items-center gap-1.5', routine ? 'text-[11.5px] text-muted-foreground' : 'text-[12px]')}>
          <span className={cn('flex', routine && 'opacity-60', grouped && !flagged && 'opacity-50')}>{icon(f)}</span>
          {!(grouped && !flagged) && <span className={cn('truncate', routine ? 'text-muted-foreground' : 'font-medium text-foreground')}>{f.from}</span>}
          {f.to ? (
            <>
              {grouped && !flagged ? (
                <span className="shrink-0 text-muted-foreground">{verb[f.kind]}</span>
              ) : (
                <ArrowRight className="size-3 shrink-0 text-faint" />
              )}
              <span className={cn('truncate', routine ? 'text-muted-foreground' : 'font-medium text-foreground')}>{f.to}</span>
            </>
          ) : (
            <span className={cn('truncate', flagged ? 'text-foreground' : 'text-muted-foreground')}>{verb[f.kind]}</span>
          )}
          <span className="ml-auto shrink-0 pl-1 text-[10.5px] tabular-nums text-faint" title={fullTime(f.at)}>{shortTime(f.at)}</span>
        </div>
        {f.text && (
          <div
            className={cn(
              'ml-5',
              routine ? 'line-clamp-1 text-[11px] text-faint' : 'line-clamp-2 text-[11.5px] text-muted-foreground',
              t === 'attention' && 'text-destructive/90',
              t === 'amber' && 'text-needs'
            )}
            title={f.text}
          >
            {f.kind !== 'stopped' && !(grouped && !flagged && f.to) && <span className={flagged ? 'opacity-70' : 'text-faint'}>{verb[f.kind]}: </span>}
            {f.text}
          </div>
        )}
      </motion.li>
    )
  })
  return (
    <ul className="pl-2 pr-3 py-1.5">
      <AnimatePresence initial={false}>{rows}</AnimatePresence>
    </ul>
  )
}

/** Memoized: unchanged feeds (see sameMissions in App.tsx) skip the 80-row rebuild. */
export const Feed = memo(FeedView)
