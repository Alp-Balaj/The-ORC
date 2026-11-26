# Mission tree: message-edge legend and hover tooltip (tree-legend)

- `MissionTree.tsx`: `EdgeLegend` (solid = spawned, dashed done-colour = message, dashed red = not sent) sits above the zoom pill, in the same bottom-left Panel, only when `showMessages`.
- Message edges now carry `data {from,to,at,text}` and `interactionWidth: 18` (React Flow's built-in transparent hit path). `onEdgeMouseEnter/Move` show a tooltip (`sender → receiver`, time, first 60 chars + ellipsis), clamped to the pane; cleared on edge leave, `onMoveStart` (pan/zoom) and when messages are toggled off. Tree edges have no data, so they show nothing.
- `App.tsx`: messages toggle got `aria-pressed` and a state-aware title.
- No focus-mode (edge dimming) exists on this branch, so nothing to preserve there. No CSS changes were needed (Tailwind utilities, existing CSS vars).
