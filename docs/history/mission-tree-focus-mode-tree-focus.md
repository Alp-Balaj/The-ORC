# Tree focus mode (mission-tree-focus-mode, tree-focus)

In `MissionTree.tsx`: focus id = hovered agent node, else the selected agent (unless a pane click dismissed it; `dismissed` is local state since selection lives in the parent).
Focus set = node + ancestors (tree edges) + children + message partners. Nodes outside get class `focus-dim`; edges stay full only if non-message with both ends in the set; message edges touching the focused node get `focus-hot` (primary stroke, opacity 1, closed arrowhead marker at the target); other message edges dim. CSS in `app.css` (opacity .35, 180ms transition). Pane click clears focus; nothing focused renders as before.
