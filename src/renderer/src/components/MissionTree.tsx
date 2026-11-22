import { useEffect, useMemo } from 'react'
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Handle, Position, useNodesState, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { AgentView, FeedEntry } from '../../../shared/types'
import { layoutTree } from '../../../shared/tree-layout'
import { cn, formatTokens } from '../lib/utils'
import { StatusDot, statusLabel } from './AgentCard'

type AgentNodeData = { agent: AgentView; selected: boolean }

const barColor: Record<AgentView['status'], string> = {
  starting: 'bg-muted-foreground/60',
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
  return (
    <div
      data-testid="tree-node"
      data-agent={a.name}
      data-status={a.status}
      className={cn(
        'relative h-[48px] w-[136px] cursor-pointer rounded-lg border bg-card py-1.5 pl-3 pr-2 shadow-sm transition-colors hover:border-input',
        a.status === 'needs-you' && !data.selected && 'border-needs/50 bg-needs/10',
        a.status === 'exited' && 'opacity-60',
        a.status === 'done' && !data.selected && 'opacity-70',
        data.selected && 'border-primary/70 bg-accent'
      )}
    >
      <span className={cn('absolute inset-y-0 left-0 w-[3px] rounded-l-lg', barColor[a.status])} />
      <Handle id="in" type="target" position={Position.Top} />
      <Handle id="l-tgt" type="target" position={Position.Left} />
      <Handle id="r-tgt" type="target" position={Position.Right} />
      <div className="flex items-center gap-1.5">
        <StatusDot status={a.status} />
        <span className="min-w-0 truncate text-[12px] font-medium">{a.name}</span>
      </div>
      <div className="mt-1 flex justify-between gap-2 text-[10.5px] text-muted-foreground">
        <span className={cn('truncate', labelColor[a.status])}>{statusLabel[a.status]}</span>
        {a.tokens > 0 && <span className="ml-auto tabular-nums">{formatTokens(a.tokens)}</span>}
      </div>
      <Handle id="out" type="source" position={Position.Bottom} />
      <Handle id="l-src" type="source" position={Position.Left} />
      <Handle id="r-src" type="source" position={Position.Right} />
    </div>
  )
}

const nodeTypes = { agent: AgentNode }

function edgeStroke(status: AgentView['status']): React.CSSProperties | undefined {
  if (status === 'working') return { stroke: 'var(--color-working)' }
  if (status === 'needs-you') return { stroke: 'var(--color-needs)' }
  return undefined
}
const NodeW = 136
const NodeH = 48

/** Refits the view whenever the set of nodes (or the panel) changes, so a new worker is
 *  never off-screen. */
function AutoFit({ shape }: { shape: string }): null {
  const { fitView } = useReactFlow()
  useEffect(() => {
    const t = setTimeout(() => void fitView({ padding: 0.12, maxZoom: 1, duration: 200 }), 30)
    return () => clearTimeout(t)
  }, [shape, fitView])
  return null
}

/** The mission's spawn tree. With `showMessages`, the latest messages between agents are
 *  drawn as dashed edges (red when Claude Code said "not sent"). */
export function MissionTree({ agents, feed, selected, onSelect, showMessages }: {
  agents: AgentView[]
  feed: FeedEntry[]
  selected: string | null
  onSelect: (terminalId: string) => void
  showMessages: boolean
}): React.JSX.Element {
  const { nodes, edges } = useMemo(() => {
    const placed = new Map(layoutTree(agents.map((a) => ({ id: a.name, parent: a.parent }))).map((p) => [p.id, p]))
    const nodes: Node<AgentNodeData>[] = agents.map((a) => ({
      id: a.name,
      type: 'agent',
      position: { x: placed.get(a.name)?.x ?? 0, y: placed.get(a.name)?.y ?? 0 },
      data: { agent: a, selected: a.terminalId === selected },
      // Fixed size (the card is fixed-size): no node waits on a measurement to be shown.
      width: NodeW,
      height: NodeH,
      draggable: false,
      connectable: false
    }))
    const edges: Edge[] = agents
      .filter((a) => a.parent && placed.has(a.parent))
      .map((a) => ({ id: `tree:${a.parent}>${a.name}`, source: a.parent!, target: a.name, sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep', animated: a.status === 'working', style: edgeStroke(a.status) }))
    if (showMessages) {
      const names = new Set(agents.map((a) => a.name))
      const seen = new Set<string>()
      for (const f of [...feed].reverse()) {
        if (f.kind !== 'message' || !f.to || !names.has(f.from) || !names.has(f.to)) continue
        const key = `${f.from}>${f.to}`
        if (seen.has(key)) continue
        seen.add(key)
        const dx = (placed.get(f.to)?.x ?? 0) - (placed.get(f.from)?.x ?? 0)
        const [sourceHandle, targetHandle] = dx > NodeW / 2 ? ['r-src', 'l-tgt'] : dx < -NodeW / 2 ? ['l-src', 'r-tgt'] : ['r-src', 'r-tgt']
        edges.push({ id: `msg:${f.id}`, source: f.from, target: f.to, sourceHandle, targetHandle, type: 'default', className: cn('message', f.status === 'failed' && 'failed'), animated: true, label: f.status === 'failed' ? 'not sent' : undefined, labelStyle: { fill: 'var(--color-destructive)', fontSize: 10 }, labelBgStyle: { fill: 'var(--color-panel)' } })
      }
    }
    return { nodes, edges }
  }, [agents, feed, selected, showMessages])

  // Nodes live in React Flow state. Each update keeps what React Flow already knows about a
  // node (its measurement) and changes only position and data. Replacing node objects on every
  // status change could leave nodes unmeasured, and hidden, after bursts of updates.
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node<AgentNodeData>>(nodes)
  useEffect(() => {
    setRfNodes((prev) => nodes.map((n) => {
      const p = prev.find((x) => x.id === n.id)
      return p ? { ...p, position: n.position, data: n.data } : n
    }))
  }, [nodes, setRfNodes])

  const shape = agents.map((a) => `${a.name}<${a.parent}`).join(',')
  return (
    <ReactFlowProvider>
    <AutoFit shape={shape} />
    <ReactFlow
      nodes={rfNodes}
      onNodesChange={onNodesChange}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_e, n) => onSelect((n.data as AgentNodeData).agent.terminalId)}
      fitView
      fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
      minZoom={0.5}
      maxZoom={1.5}
      nodesDraggable={false}
      nodesConnectable={false}
      proOptions={{ hideAttribution: true }}
      colorMode="dark"
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#1f252e" />
    </ReactFlow>
    </ReactFlowProvider>
  )
}
