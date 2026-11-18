import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, CheckCheck, CircleHelp, GitFork, Inbox, Keyboard, OctagonX, Send, TriangleAlert } from 'lucide-react'
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
  }
}

const verb: Record<FeedEntry['kind'], string> = {
  spawn: 'spawned',
  message: 'messaged',
  delivered: 'reached',
  done: 'reported done to',
  question: 'asks',
  steer: 'typed to',
  stopped: 'stopped the mission'
}

const time = (t: number): string => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export function Feed({ feed }: { feed: FeedEntry[] }): React.JSX.Element {
  const items = [...feed].reverse().slice(0, 80)
  if (items.length === 0) {
    return <div className="px-3 py-4 text-[12px] text-muted-foreground">Spawns, messages and reports appear here.</div>
  }
  return (
    <ul className="space-y-0.5 px-2 py-1.5">
      <AnimatePresence initial={false}>
        {items.map((f) => (
          <motion.li
            key={f.id}
            layout
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.15 }}
            data-testid="feed-entry"
            data-kind={f.kind}
            data-status={f.status ?? ''}
            className="rounded-md px-1.5 py-1 hover:bg-accent/60"
          >
            <div className="flex items-center gap-1.5 text-[12px]">
              {icon(f)}
              <span className="font-medium">{f.from}</span>
              {f.to ? (
                <>
                  <ArrowRight className="size-3 text-muted-foreground" />
                  <span className="font-medium">{f.to}</span>
                </>
              ) : (
                <span className="text-muted-foreground">{verb[f.kind]}</span>
              )}
              <span className="ml-auto shrink-0 text-[10.5px] tabular-nums text-muted-foreground">{time(f.at)}</span>
            </div>
            {f.text && (
              <div className={cn('ml-5 line-clamp-2 text-[11.5px] text-muted-foreground', f.status === 'failed' && 'text-destructive/90')} title={f.text}>
                {f.kind !== 'stopped' && <span className="text-muted-foreground/70">{verb[f.kind]}: </span>}
                {f.text}
              </div>
            )}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  )
}
