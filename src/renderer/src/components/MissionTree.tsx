import { useEffect, useMemo, useState } from 'react'
import { ReactFlow, ReactFlowProvider, BaseEdge, Handle, Position, PanOnScrollMode, useNodesState, useReactFlow, useStore, useStoreApi, type Edge, type EdgeProps, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
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
const barClass: Record<AgentStatus, string> = {
  starting: 'border-l-muted-foreground/60',
  working: 'border-l-working',
  idle: 'border-l-muted-foreground',
  'needs-you': 'border-l-needs',
  done: 'border-l-done',
  exited: 'border-l-exited'
}
// Bottom-left source: the elbow down into a stacked column starts here.
const stackHandle = { left: 6, opacity: 0 }
const hidden = { opacity: 0 }

function AgentNode({ data }: NodeProps<Node<AgentNodeData>>): React.JSX.Element {
  const a = data.agent
  const far = useStore((s) => s.transform[2] < SemanticZoom)
  const base = cn(
    'cursor-pointer border bg-card shadow-sm transition-colors hover:border-input',
    data.selected && 'border-primary/70 bg-accent',
    a.status === 'needs-you' && !data.selected && 'border-needs/50'
  )
  if (data.row) {
    return (
      <div
        data-testid="tree-node"
        data-agent={a.name}
        data-status={a.status}
        style={{ width: '100%', height: '100%' }}
        className={cn(base, 'flex items-center gap-1.5 rounded-md border-l-[3px] px-2', barClass[a.status])}
      >
        <Handle type="target" position={Position.Left} style={hidden} />
        <StatusDot status={a.status} className={cn(far && 'size-3')} />
        <span className={cn('min-w-0 flex-1 truncate font-medium', far ? 'text-[15px]' : 'text-[11.5px]')}>{a.name}</span>
        {!far && a.tokens > 0 && <span className="text-[10.5px] tabular-nums text-muted-foreground">{formatTokens(a.tokens)}</span>}
        <Handle type="source" position={Position.Bottom} style={stackHandle} />
      </div>
    )
  }
  return (
    <div
      data-testid="tree-node"
      data-agent={a.name}
      data-status={a.status}
      style={{ width: stackSizes.cardW, height: stackSizes.cardH }}
      className={cn(base, 'rounded-lg px-2.5 py-1.5', far && 'flex items-center')}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex min-w-0 items-center gap-1.5">
        <StatusDot status={a.status} className={cn(far && 'size-3.5')} />
        <span className={cn('truncate font-medium', far ? 'text-[17px]' : 'text-[12px]')}>{a.name}</span>
      </div>
      {!far && (
        <div className="mt-0.5 flex justify-between text-[10.5px] text-muted-foreground">
          <span>{statusLabel[a.status]}</span>
          {a.tokens > 0 && <span className="tabular-nums">{formatTokens(a.tokens)}</span>}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
      <Handle type="source" position={Position.Bottom} id="stack" style={stackHandle} />
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
      className={cn('flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed bg-card/60 px-2 text-muted-foreground transition-colors hover:border-input hover:text-foreground', far ? 'text-[15px]' : 'text-[11px]')}
    >
      <Handle type="target" position={Position.Left} style={hidden} />
      <span className="inline-block size-2 shrink-0 rounded-full bg-done/70" />
      {data.expanded ? `hide ${data.count} done` : `+${data.count} done`}
      <Handle type="source" position={Position.Bottom} style={stackHandle} />
    </div>
  )
}

const nodeTypes = { agent: AgentNode, chip: ChipNode }

/** Down from the parent's bottom-left, then right into the stacked row: a file-tree elbow. */
function ElbowEdge({ sourceX, sourceY, targetX, targetY, style, markerEnd }: EdgeProps): React.JSX.Element {
  return <BaseEdge path={`M ${sourceX},${sourceY} V ${targetY} H ${targetX}`} style={style} markerEnd={markerEnd} />
}
const edgeTypes = { elbow: ElbowEdge }
const FitPad = 12
const FitMinZoom = 0.6

/** Refits the view whenever the set of nodes changes, so a new worker is never off-screen.
 *  Never zooms below FitMinZoom: a tree taller than the panel is aligned to its top and
 *  scrolls instead. */
function AutoFit({ shape }: { shape: string }): null {
  const { setViewport, getNodesBounds, getNodes } = useReactFlow()
  const store = useStoreApi()
  useEffect(() => {
    const t = setTimeout(() => {
      const { width: W, height: H } = store.getState()
      const b = getNodesBounds(getNodes())
      if (!W || !H || !b.width) return
      const zoom = Math.max(FitMinZoom, Math.min(1, (W - 2 * FitPad) / b.width, (H - 2 * FitPad) / b.height))
      const x = (W - b.width * zoom) / 2 - b.x * zoom
      const y = b.height * zoom + 2 * FitPad > H ? FitPad - b.y * zoom : (H - b.height * zoom) / 2 - b.y * zoom
      void setViewport({ x, y, zoom }, { duration: 200 })
    }, 30)
    return () => clearTimeout(t)
  }, [shape, setViewport, getNodesBounds, getNodes, store])
  return null
}

/** The mission's spawn tree, as a stacked graph: coordinator and leads side by side, each
 *  lead's workers in a column under it, finished workers folded into a "+N done" chip. With
 *  `showMessages`, the latest messages between agents are drawn as dashed edges (red when
 *  Claude Code said "not sent"). */
export function MissionTree({ agents, feed, selected, onSelect, showMessages }: {
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
    const tree = (source: string, target: string, animated: boolean): Edge => (isRow(target)
      ? { id: `tree:${source}>${target}`, source, target, sourceHandle: isRow(source) ? undefined : 'stack', type: 'elbow', animated }
      : { id: `tree:${source}>${target}`, source, target, type: 'smoothstep', animated })
    const edges: Edge[] = shown.filter((a) => a.parent && placed.has(a.parent)).map((a) => tree(a.parent!, a.name, a.status === 'working'))
    for (const lead of foldedBy.keys()) if (placed.has(lead)) edges.push(tree(lead, `chip:${lead}`, false))
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
        edges.push({ id: `msg:${f.id}`, source: from, target: to, type: 'straight', className: cn('message', f.status === 'failed' && 'failed'), animated: true, label: f.status === 'failed' ? 'not sent' : undefined, labelStyle: { fill: 'var(--color-destructive)', fontSize: 10 }, labelBgStyle: { fill: 'var(--color-panel)' } })
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
    />
    </ReactFlowProvider>
  )
}
