import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, BaseEdge, Handle, Position, PanOnScrollMode, useNodesState, useReactFlow, useStore, useStoreApi, type Edge, type EdgeProps, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Crown } from 'lucide-react'
import type { AgentStatus, AgentView, FeedEntry } from '../../../shared/types'
import { layoutStacked, stackSizes } from '../../../shared/tree-layout'
import { cn, formatTokens } from '../lib/utils'
import { StatusDot, statusLabel } from './AgentCard'

type AgentNodeData = { kind: 'agent'; agent: AgentView; selected: boolean; row: boolean }
type ChipNodeData = { kind: 'chip'; lead: string; count: number; expanded: boolean }
type TreeNodeData = AgentNodeData | ChipNodeData

/** Below this zoom a node shows only a larger dot and its name. */
const SemanticZoom = 0.6
const finished = (s: AgentStatus): boolean => s === 'done' || s === 'exited'
// Handles are invisible anchor points; every edge names the one it uses.
const hidden: React.CSSProperties = { opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0, pointerEvents: 'none' }
// The trunk down into a stacked column leaves the parent's bottom here (see stackSizes.trunk).
const trunkHandle: React.CSSProperties = { ...hidden, left: stackSizes.trunk }

/** Tree handles (in, out, stack) and message handles on both sides (msg-l, msg-r). */
function Handles({ card }: { card: boolean }): React.JSX.Element {
  return (
    <>
      {card
        ? <Handle id="in" type="target" position={Position.Top} style={hidden} />
        : <Handle id="in" type="target" position={Position.Left} style={hidden} />}
      {card && <Handle id="out" type="source" position={Position.Bottom} style={hidden} />}
      <Handle id="stack" type="source" position={Position.Bottom} style={trunkHandle} />
      <Handle id="msg-l" type="source" position={Position.Left} style={hidden} />
      <Handle id="msg-l" type="target" position={Position.Left} style={hidden} />
      <Handle id="msg-r" type="source" position={Position.Right} style={hidden} />
      <Handle id="msg-r" type="target" position={Position.Right} style={hidden} />
    </>
  )
}

const barColor: Record<AgentView['status'], string> = {
  starting: 'bg-faint',
  working: 'bg-working',
  idle: 'bg-muted-foreground',
  'needs-you': 'bg-needs',
  done: 'bg-done',
  exited: 'bg-exited'
}

const labelColor: Record<AgentView['status'], string> = {
  starting: 'text-muted-foreground',
  working: 'text-working',
  idle: 'text-muted-foreground',
  'needs-you': 'text-needs',
  done: 'text-done',
  exited: 'text-exited-foreground'
}

function AgentNode({ data }: NodeProps<Node<AgentNodeData>>): React.JSX.Element {
  const a = data.agent
  const far = useStore((s) => s.transform[2] < SemanticZoom)
  const base = cn(
    'cursor-pointer border border-border bg-card transition-colors hover:border-border-strong hover:bg-accent',
    a.status === 'needs-you' && !data.selected && 'border-needs/50 bg-needs/10 shadow-[0_0_0_3px] shadow-needs/15 hover:bg-needs/15',
    a.status === 'exited' && a.exitKind !== 'crashed' && 'opacity-60',
    a.exitKind === 'crashed' && !data.selected && 'border-destructive/50',
    a.status === 'done' && !data.selected && 'opacity-70',
    data.selected && 'border-primary/60 bg-selected shadow-[0_0_0_1px] shadow-primary/25 hover:bg-selected'
  )
  if (data.row) {
    return (
      <div
        data-testid="tree-node"
        data-agent={a.name}
        data-status={a.status}
        style={{ width: '100%', height: '100%' }}
        className={cn(base, 'relative flex items-center gap-1.5 rounded-md pl-2.5 pr-2')}
      >
        <span className={cn('absolute inset-y-0 left-0 w-[3px] rounded-l-md', a.exitKind === 'crashed' ? 'bg-destructive' : barColor[a.status])} />
        <Handles card={false} />
        <StatusDot status={a.status} crashed={a.exitKind === 'crashed'} className={cn(far && 'size-3')} />
        <span className={cn('min-w-0 flex-1 truncate font-medium', far ? 'text-[15px]' : 'text-[11.5px]')}>{a.name}</span>
        {!far && a.tokens > 0 && <span className="text-[10.5px] tabular-nums text-faint">{formatTokens(a.tokens)}</span>}
      </div>
    )
  }
  return (
    <div
      data-testid="tree-node"
      data-agent={a.name}
      data-status={a.status}
      style={{ width: stackSizes.cardW, height: stackSizes.cardH }}
      className={cn(base, 'relative rounded-lg py-1.5 pl-3 pr-2', far && 'flex items-center')}
    >
      <span className={cn('absolute inset-y-0 left-0 w-[3px] rounded-l-lg', a.exitKind === 'crashed' ? 'bg-destructive' : barColor[a.status])} />
      <Handles card />
      <div className="flex min-w-0 items-center gap-1.5">
        <StatusDot status={a.status} crashed={a.exitKind === 'crashed'} className={cn(far && 'size-3.5')} />
        <span className={cn('truncate font-medium', far ? 'text-[17px]' : 'text-[12px]')}>{a.name}</span>
        {a.role === 'coordinator' && <Crown aria-label="coordinator" className={cn('ml-auto shrink-0 text-muted-foreground', far ? 'size-4' : 'size-3')} />}
      </div>
      {!far && (
        <div className="mt-1 flex justify-between gap-2 pl-3.5 text-[10.5px] text-muted-foreground">
          <span className={cn('truncate', a.exitKind === 'crashed' ? 'text-destructive' : labelColor[a.status])}>{a.exitKind === 'crashed' ? 'crashed' : statusLabel[a.status]}</span>
          {a.tokens > 0 && <span className="ml-auto tabular-nums text-faint">{formatTokens(a.tokens)}</span>}
        </div>
      )}
    </div>
  )
}

/** "+N done": a lead's finished workers, folded. Click to show them, again to fold. */
function ChipNode({ data }: NodeProps<Node<ChipNodeData>>): React.JSX.Element {
  const far = useStore((s) => s.transform[2] < SemanticZoom)
  return (
    <div
      data-testid="tree-chip"
      data-lead={data.lead}
      style={{ width: '100%', height: '100%' }}
      className={cn('flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-border-strong bg-card/60 pl-2.5 pr-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground', far ? 'text-[15px]' : 'text-[11px]')}
    >
      <Handles card={false} />
      <span className="inline-block size-2 shrink-0 rounded-full bg-done/70" />
      {data.expanded ? `hide ${data.count} done` : `+${data.count} done`}
    </div>
  )
}

function edgeStroke(status: AgentStatus): React.CSSProperties | undefined {
  if (status === 'working') return { stroke: 'var(--color-working)' }
  if (status === 'needs-you') return { stroke: 'var(--color-needs)' }
  return undefined
}

const nodeTypes = { agent: AgentNode, chip: ChipNode }

/** Down from the parent's trunk, then right into the stacked row: a file-tree elbow. */
function ElbowEdge({ sourceX, sourceY, targetX, targetY, style, markerEnd }: EdgeProps): React.JSX.Element {
  return <BaseEdge path={`M ${sourceX},${sourceY} V ${targetY} H ${targetX}`} style={style} markerEnd={markerEnd} />
}
/** Card to card: down from the bottom centre, across halfway, down into the top centre. */
function StepEdge({ sourceX, sourceY, targetX, targetY, style, markerEnd }: EdgeProps): React.JSX.Element {
  const my = (sourceY + targetY) / 2
  return <BaseEdge path={`M ${sourceX},${sourceY} V ${my} H ${targetX} V ${targetY}`} style={style} markerEnd={markerEnd} />
}
const edgeTypes = { elbow: ElbowEdge, step: StepEdge }
const FitPad = 12
const FitMinZoom = 0.6

/** Refits the view whenever the set of nodes changes, so a new worker is never off-screen,
 *  and 150ms after the panel stops changing size (not on every pixel of a drag).
 *  Never zooms below FitMinZoom: a tree taller than the panel is aligned to its top and
 *  scrolls instead. */
function AutoFit({ shape }: { shape: string }): null {
  const { setViewport, getNodesBounds, getNodes } = useReactFlow()
  const store = useStoreApi()
  const width = useStore((s) => s.width)
  const height = useStore((s) => s.height)
  const fit = useCallback((): void => {
    const { width: W, height: H } = store.getState()
    const b = getNodesBounds(getNodes())
    if (!W || !H || !b.width) return
    const zoom = Math.max(FitMinZoom, Math.min(1, (W - 2 * FitPad) / b.width, (H - 2 * FitPad) / b.height))
    const x = (W - b.width * zoom) / 2 - b.x * zoom
    const y = b.height * zoom + 2 * FitPad > H ? FitPad - b.y * zoom : (H - b.height * zoom) / 2 - b.y * zoom
    void setViewport({ x, y, zoom }, { duration: 200 })
  }, [setViewport, getNodesBounds, getNodes, store])
  useEffect(() => {
    const t = setTimeout(fit, 30)
    return () => clearTimeout(t)
  }, [shape, fit])
  useEffect(() => {
    const t = setTimeout(fit, 150)
    return () => clearTimeout(t)
  }, [width, height, fit])
  return null
}

/** The mission's spawn tree, as a stacked graph: coordinator and leads side by side, each
 *  lead's workers in a column under it, finished workers folded into a "+N done" chip. With
 *  `showMessages`, the latest messages between agents are drawn as dashed edges (red when
 *  Claude Code said "not sent"). */
function MissionTreeView({ agents, feed, selected, onSelect, showMessages }: {
  agents: AgentView[]
  feed: FeedEntry[]
  selected: string | null
  onSelect: (terminalId: string) => void
  showMessages: boolean
}): React.JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const { nodes, edges, shape } = useMemo(() => {
    const byName = new Map(agents.map((a) => [a.name, a]))
    const parentOf = (a: AgentView): string | null => (a.parent && byName.has(a.parent) ? a.parent : null)
    // Depth and lead (depth-1 ancestor) of every agent; a cycle is cut where it repeats.
    const chain = (a: AgentView): string[] => {
      const up = [a.name]
      for (let p = parentOf(a); p && !up.includes(p); p = parentOf(byName.get(p)!)) up.push(p)
      return up
    }
    const leadOf = new Map<string, string | null>()
    for (const a of agents) {
      const up = chain(a)
      leadOf.set(a.name, up.length >= 3 ? up[up.length - 2] : null)
    }
    // A worker folds when it and everything under it is finished. The selected agent always shows.
    const kids = new Map<string, AgentView[]>()
    for (const a of agents) { const p = parentOf(a); if (p) kids.set(p, [...(kids.get(p) ?? []), a]) }
    const foldable = new Map<string, boolean>()
    const canFold = (a: AgentView, seen: Set<string>): boolean => {
      if (foldable.has(a.name)) return foldable.get(a.name)!
      if (seen.has(a.name)) return true
      seen.add(a.name)
      const v = finished(a.status) && a.terminalId !== selected && (kids.get(a.name) ?? []).every((k) => canFold(k, seen))
      foldable.set(a.name, v)
      return v
    }
    const foldedBy = new Map<string, string[]>() // lead -> its finished workers
    for (const a of agents) {
      const lead = leadOf.get(a.name)
      if (lead && canFold(a, new Set())) foldedBy.set(lead, [...(foldedBy.get(lead) ?? []), a.name])
    }
    // One finished worker isn't worth a chip: only fold two or more.
    for (const [lead, names] of foldedBy) if (names.length < 2) foldedBy.delete(lead)
    const folded = new Map<string, string>() // agent -> chip id
    for (const [lead, names] of foldedBy) if (!expanded.has(lead)) for (const n of names) folded.set(n, `chip:${lead}`)

    const shown = agents.filter((a) => !folded.has(a.name))
    const input = [
      ...shown.map((a) => ({ id: a.name, parent: a.parent })),
      ...[...foldedBy.keys()].map((lead) => ({ id: `chip:${lead}`, parent: lead }))
    ]
    const placed = new Map(layoutStacked(input).map((p) => [p.id, p]))
    const nodes: Node<TreeNodeData>[] = []
    for (const a of shown) {
      const p = placed.get(a.name)
      nodes.push({
        id: a.name,
        type: 'agent',
        position: { x: p?.x ?? 0, y: p?.y ?? 0 },
        data: { kind: 'agent', agent: a, selected: a.terminalId === selected, row: (p?.depth ?? 0) >= 2 },
        // Fixed size: no node waits on a measurement to be shown.
        width: p?.w ?? stackSizes.cardW,
        height: p?.h ?? stackSizes.cardH,
        draggable: false,
        connectable: false
      })
    }
    for (const [lead, names] of foldedBy) {
      const p = placed.get(`chip:${lead}`)
      if (!p) continue
      nodes.push({
        id: `chip:${lead}`,
        type: 'chip',
        position: { x: p.x, y: p.y },
        data: { kind: 'chip', lead, count: names.length, expanded: expanded.has(lead) },
        width: p.w,
        height: p.h,
        draggable: false,
        connectable: false
      })
    }
    const isRow = (id: string): boolean => (placed.get(id)?.depth ?? 0) >= 2
    const tree = (source: string, target: string, status?: AgentStatus): Edge => {
      const animated = status === 'working'
      const style = status && edgeStroke(status)
      return isRow(target)
        ? { id: `tree:${source}>${target}`, source, target, sourceHandle: 'stack', targetHandle: 'in', type: 'elbow', animated, style }
        : { id: `tree:${source}>${target}`, source, target, sourceHandle: 'out', targetHandle: 'in', type: 'step', animated, style }
    }
    const edges: Edge[] = shown.filter((a) => a.parent && placed.has(a.parent)).map((a) => tree(a.parent!, a.name, a.status))
    for (const lead of foldedBy.keys()) if (placed.has(lead)) edges.push(tree(lead, `chip:${lead}`))
    if (showMessages) {
      const end = (name: string): string => folded.get(name) ?? name
      const seen = new Set<string>()
      for (const f of [...feed].reverse()) {
        if (f.kind !== 'message' || !f.to || !byName.has(f.from) || !byName.has(f.to)) continue
        const from = end(f.from)
        const to = end(f.to)
        const key = `${from}>${to}`
        if (from === to || seen.has(key)) continue
        seen.add(key)
        // Side handles keep message curves off the tree lines, which run through tops and
        // bottoms (and rows' left sides). Same column: loop out on the right. Same level: the
        // facing sides, through the gap. Across levels: both ends on the side where the lower
        // node sticks out, so the curve goes around the tree, not through it. Rows use right.
        const a = placed.get(from)
        const b = placed.get(to)
        if (!a || !b) continue
        const dx = b.x + b.w / 2 - (a.x + a.w / 2)
        const lowerSticksLeft = b.y > a.y ? dx < 0 : dx > 0
        let sourceHandle = 'msg-r'
        let targetHandle = 'msg-r'
        if (Math.abs(dx) < stackSizes.cardW / 2) { /* same column */ }
        else if (Math.abs(b.y - a.y) < stackSizes.rowH) { sourceHandle = dx > 0 ? 'msg-r' : 'msg-l'; targetHandle = dx > 0 ? 'msg-l' : 'msg-r' }
        else if (lowerSticksLeft) { sourceHandle = 'msg-l'; targetHandle = 'msg-l' }
        if (isRow(to)) targetHandle = 'msg-r'
        const failed = f.status === 'failed'
        edges.push({
          id: `msg:${f.id}`, source: from, target: to, sourceHandle, targetHandle, type: 'default', zIndex: 1,
          className: cn('message', failed && 'failed'), style: { opacity: 0.55 }, animated: true,
          label: failed ? 'not sent' : undefined,
          labelStyle: { fill: 'var(--color-destructive)', fontSize: 10 },
          labelBgStyle: { fill: 'var(--color-background)', fillOpacity: 0.95 },
          labelBgPadding: [3, 1], labelBgBorderRadius: 3
        })
      }
    }
    return { nodes, edges, shape: nodes.map((n) => `${n.id}@${n.position.x},${n.position.y}`).join(',') }
  }, [agents, feed, selected, showMessages, expanded])

  // Nodes live in React Flow state. Each update keeps what React Flow already knows about a
  // node (its measurement) and changes only position, size and data. Replacing node objects on
  // every status change could leave nodes unmeasured, and hidden, after bursts of updates.
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node<TreeNodeData>>(nodes)
  useEffect(() => {
    setRfNodes((prev) => nodes.map((n) => {
      const p = prev.find((x) => x.id === n.id)
      return p && p.type === n.type ? { ...p, position: n.position, width: n.width, height: n.height, data: n.data } : n
    }))
  }, [nodes, setRfNodes])

  return (
    <ReactFlowProvider>
    <AutoFit shape={shape} />
    <ReactFlow
      nodes={rfNodes}
      onNodesChange={onNodesChange}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={(_e, n) => {
        const d = n.data as TreeNodeData
        if (d.kind === 'agent') onSelect(d.agent.terminalId)
        else setExpanded((s) => { const x = new Set(s); if (x.has(d.lead)) x.delete(d.lead); else x.add(d.lead); return x })
      }}
      fitView
      fitViewOptions={{ padding: 0.1, minZoom: FitMinZoom, maxZoom: 1 }}
      minZoom={0.3}
      maxZoom={1.5}
      panOnScroll
      panOnScrollMode={PanOnScrollMode.Vertical}
      nodesDraggable={false}
      nodesConnectable={false}
      proOptions={{ hideAttribution: true }}
      colorMode="dark"
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--color-border)" />
    </ReactFlow>
    </ReactFlowProvider>
  )
}

/** Memoized: the App re-renders on every push; the tree only needs the ones that change it. */
export const MissionTree = memo(MissionTreeView)
