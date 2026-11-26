# Mission tree: keyboard and accessibility (lead: tree-a11y)

## What was built

All in `src/renderer/src/components/MissionTree.tsx`, plus one rule in `src/renderer/src/app.css`.

- **Keyboard movement.** Arrow keys move through the nodes on screen: Up = parent, Down = first child,
  Left/Right = previous/next sibling. Siblings run in layout order (sorted by y, then x). Focus moves
  with the arrows. An agent node also gets selected, so the terminal follows the arrow, as a click would.
  A chip (`+N done`) only takes focus.
- **Enter.** On an agent node it selects the agent's terminal (same as a click). On a chip, Enter is
  the button's own click, so it toggles like a click does (no separate handler).
- **Roving tab stop.** Exactly one node has `tabIndex=0`: the focused node if it is still shown, else
  the selected agent, else the coordinator. The others are `-1`. Tab leaves the tree in one stop.
- **Esc.** Clears the status highlight (summary bar filter), clears the active node and blurs it.
  It calls `preventDefault` only when it cleared something, so App's Esc (leave merge/review/app
  screens) still works when the tree has nothing to clear.
- **Chip.** Now a real `<button>` with `aria-expanded` and an `aria-label` that states the count
  and folded/shown state. Its `data-tree-id` is `chip:<lead>`.
- **ARIA.** The canvas wrapper is `role="tree"` (label "Mission tree"). Each agent's inner box is
  `role="treeitem"` with `aria-level` (1 coordinator, 2 lead, 3+ worker), `aria-selected` (is its
  terminal selected) and `aria-expanded` when it has shown children. `aria-label` reads as
  "name, role, status" (plus "n of m done" for leads with workers).
- **Focus ring.** `[data-tree-id]:focus-visible` in app.css: 2px solid `var(--color-primary)`,
  3px offset. The offset keeps it clear of the `.hit` outline.
- **Status shapes at far zoom.** When labels are hidden (`far`), `StatusGlyph` replaces the colour
  dot: needs-you = triangle, done = check, working = spinning loader (only with motion allowed),
  exited = X, crashed = X in destructive colour, starting = dashed circle, idle = plain circle.
  Above the far zoom the status text label is still shown, so status is never colour-only.

## How it works

- `MissionTreeView` holds `active` (the node with DOM focus). The `onFocus` on the tree wrapper sets it,
  so focus by mouse, Tab or arrows all update the same state.
- The layout `useMemo` computes `tabStop` and passes `tab`, `level` and `kids` in node data.
  `kids` is the count of children in the layout input, which is the same rule as the layout.
- A second `useMemo` (`nav`) builds the key map from the rendered nodes. A node's parent is
  `data.parent` for agents and `data.lead` for chips. Unknown parents count as roots, as in the layout.
- Arrow moves set `focus` state, so `JumpTo` pans to the node, then call `.focus({ preventScroll: true })`
  on the element, so the browser does not scroll the flow container a second time.
- `nodesFocusable={false}` and `edgesFocusable={false}` stop React Flow from making every node and edge
  a tab stop.

## Facts established

- `AgentRole` is only `'coordinator' | 'worker'`, so "team lead" is derived from depth (level 2).
- `App.tsx` `selectAgent` sets the main view to `terminal` and does not focus the terminal. So arrow
  selection does not steal focus from the tree.
- There is no app-level "deselect" callable from the tree (`onSelect` takes a terminal id and
  `App.tsx` is not owned by this lead). Esc therefore clears focus and the highlight but leaves the
  selected terminal in place.
- `App.tsx` has a window-level Esc handler that leaves merge/review/app screens. The tree's Esc
  calls `preventDefault` only when it cleared something, so that handler still runs otherwise.
- `ZoomControls` (a React Flow `Panel`) sits inside the `role="tree"` wrapper. It is a button group
  inside a tree, which is not strictly valid ARIA. Moving it outside the tree would need a change to
  how the panel is placed, so it was left alone.
- The chip's `onNodeClick` toggle still handles clicks; the native button click for Enter/Space
  bubbles to it. Only one toggle path exists.
- `JumpTo` raises zoom to at least 0.8 on every arrow move. A user at far zoom is therefore pulled
  to 0.8 when they arrow to a node; this is the same behaviour as the "needs you" jump.
- Lucide icons used (lucide-react 1.72.0): `Check`, `Circle`, `CircleDashed`, `LoaderCircle`,
  `TriangleAlert`, `X`. Confirmed present in the installed `.d.ts`.
- Typecheck passes (`pnpm typecheck`). No tests were run, per the brief.
