# Crown icon on the coordinator node

`AgentNode` card variant in `src/renderer/src/components/MissionTree.tsx` renders a lucide `Crown`
(right-aligned in the name row, size-3, size-4 at far zoom, muted colour) when `agent.role === 'coordinator'`.
Card size/layout unchanged (it is a shrink-0 icon in the existing flex row; the name truncates).
