# Tree node hover card

- `components/NodeHoverCard.tsx`: portaled (document.body), `position: fixed`, `pointer-events: none` card. Shown 300ms after hover on an agent node (AgentNode in MissionTree.tsx), hidden on leave and below SemanticZoom (0.6). Placed right of the node's rect, flips left, clamped vertically.
- Rows: role, parent, full status label, time in status (ticks every 1s), tokens, last feed line (omitted if none; newest feed entry whose `from` is the agent, computed in the tree's nodes memo into node data `lastLine`/`parent`).
- Time in status: AgentView has no status timestamp, so `observeStatus` (module map) records when the renderer first saw the current status. Resets on app reload.
- Not shown for the selected node persistently (hover only). Test ids: node-hover-card, node-hover-{name,role,parent,status,since,tokens,last}.
- Rect is captured at show time; not tracked during pan (card closes on leave).
