import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AgentStatus, AgentView } from '../../../shared/types'
import { cn, formatTokens } from '../lib/utils'
import { StatusDot, statusLabel } from './AgentCard'

const Width = 248
const Gap = 10
const Margin = 8
export const HoverDelay = 300

// When the renderer first saw each agent in its current status (no timestamp exists in AgentView).
const seen = new Map<string, { status: AgentStatus; since: number }>()
/** Call on every render of a node: records the moment an agent's status first shows up. */
export function observeStatus(name: string, status: AgentStatus): void {
  const s = seen.get(name)
  if (!s || s.status !== status) seen.set(name, { status, since: Date.now() })
}

function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

function Row({ label, children, testid }: { label: string; children: React.ReactNode; testid: string }): React.JSX.Element {
  return (
    <div data-testid={testid} className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-faint">{label}</span>
      <span className="min-w-0 truncate text-right text-foreground">{children}</span>
    </div>
  )
}

/** Compact detail card for a tree node. Portaled to body and fixed-positioned from the node's
 *  rect, so the pan/zoom transform never scales or clips it; pointer-events none, so it can
 *  never steal the hover that opened it. */
export function NodeHoverCard({ agent, rect, parent, lastLine }: {
  agent: AgentView
  rect: DOMRect
  parent: string | null
  lastLine: string | null
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0
    let left = rect.right + Gap
    if (left + Width > window.innerWidth - Margin) left = rect.left - Gap - Width
    left = Math.max(Margin, Math.min(left, window.innerWidth - Width - Margin))
    const top = Math.max(Margin, Math.min(rect.top, window.innerHeight - h - Margin))
    setPos({ left, top })
  }, [rect, lastLine])

  const since = seen.get(agent.name)?.since ?? now
  const crashed = agent.exitKind === 'crashed'
  return createPortal(
    <div
      ref={ref}
      data-testid="node-hover-card"
      role="tooltip"
      style={{ position: 'fixed', left: pos?.left ?? 0, top: pos?.top ?? 0, width: Width, visibility: pos ? 'visible' : 'hidden', pointerEvents: 'none', zIndex: 60 }}
      className="rounded-lg border border-border-strong bg-card p-2.5 text-[11px] shadow-lg shadow-black/40"
    >
      <div className="mb-2 flex items-center gap-1.5 border-b border-border pb-2">
        <StatusDot status={agent.status} crashed={crashed} />
        <span data-testid="node-hover-name" className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">{agent.name}</span>
      </div>
      <div className="flex flex-col gap-1">
        <Row label="Role" testid="node-hover-role">{agent.role}</Row>
        <Row label="Parent" testid="node-hover-parent">{parent ?? '—'}</Row>
        <Row label="Status" testid="node-hover-status"><span className={cn(crashed && 'text-destructive')}>{crashed ? 'crashed' : statusLabel[agent.status]}</span></Row>
        <Row label="In status" testid="node-hover-since"><span className="tabular-nums">{duration(now - since)}</span></Row>
        <Row label="Tokens" testid="node-hover-tokens"><span className="tabular-nums">{formatTokens(agent.tokens)}</span></Row>
      </div>
      {lastLine && (
        <div data-testid="node-hover-last" className="mt-2 border-t border-border pt-2">
          <div className="text-faint">Last message</div>
          <div className="mt-0.5 line-clamp-3 break-words text-muted-foreground">{lastLine}</div>
        </div>
      )}
    </div>,
    document.body
  )
}
