import { useEffect, useMemo } from 'react'
import { ReactFlow, ReactFlowProvider, Handle, Position, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { AgentView, FeedEntry } from '../../../shared/types'
import { layoutTree } from '../../../shared/tree-layout'
import { cn, formatTokens } from '../lib/utils'
import { StatusDot, statusLabel } from './AgentCard'

type AgentNodeData = { agent: AgentView; selected: boolean }

function AgentNode({ data }: NodeProps<Node<AgentNodeData>>): React.JSX.Element {
  const a = data.agent
  return (
    <div
      data-testid="tree-node"
      data-agent={a.name}
      data-status={a.status}
      className={cn(
        'w-[148px] cursor-pointer rounded-lg border bg-card px-2.5 py-1.5 shadow-sm transition-colors hover:border-input',
        data.selected && 'border-primary/70 bg-accent',
        a.status === 'needs-you' && !data.selected && 'border-needs/50'
      )}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-1.5">
        <StatusDot status={a.status} />
        <span className="truncate text-[12px] font-medium">{a.name}</span>
      </div>
      <div className="mt-0.5 flex justify-between text-[10.5px] text-muted-foreground">
        <span>{statusLabel[a.status]}</span>
        {a.tokens > 0 && <span className="tabular-nums">{formatTokens(a.tokens)}</span>}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

const nodeTypes = { agent: AgentNode }

/** Refits the view whenever the set of nodes (or the panel) changes, so a new worker is
 *  never off-screen. */
function AutoFit({ shape }: { shape: string }): null {
  const { fitView } = useReactFlow()
  useEffect(() => {
    const t = setTimeout(() => void fitView({ padding: 0.2, maxZoom: 1, duration: 200 }), 30)
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
      draggable: false,
      connectable: false
    }))
    const edges: Edge[] = agents
      .filter((a) => a.parent && placed.has(a.parent))
      .map((a) => ({ id: `tree:${a.parent}>${a.name}`, source: a.parent!, target: a.name, type: 'smoothstep', animated: a.status === 'working' }))
    if (showMessages) {
      const names = new Set(agents.map((a) => a.name))
      const seen = new Set<string>()
      for (const f of [...feed].reverse()) {
        if (f.kind !== 'message' || !f.to || !names.has(f.from) || !names.has(f.to)) continue
        const key = `${f.from}>${f.to}`
        if (seen.has(key)) continue
        seen.add(key)
        edges.push({ id: `msg:${f.id}`, source: f.from, target: f.to, type: 'straight', className: cn('message', f.status === 'failed' && 'failed'), animated: true, label: f.status === 'failed' ? 'not sent' : undefined, labelStyle: { fill: 'var(--color-destructive)', fontSize: 10 }, labelBgStyle: { fill: 'var(--color-panel)' } })
      }
    }
    return { nodes, edges }
  }, [agents, feed, selected, showMessages])

  const shape = agents.map((a) => `${a.name}<${a.parent}`).join(',')
  return (
    <ReactFlowProvider>
    <AutoFit shape={shape} />
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_e, n) => onSelect((n.data as AgentNodeData).agent.terminalId)}
      fitView
      fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
      minZoom={0.3}
      maxZoom={1.5}
      nodesDraggable={false}
      nodesConnectable={false}
      proOptions={{ hideAttribution: true }}
      colorMode="dark"
    />
    </ReactFlowProvider>
  )
}
