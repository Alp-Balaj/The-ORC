# Mission tree: status summary bar + jump to needs-you

All in `src/renderer/src/components/MissionTree.tsx` (App.tsx and app.css untouched; Tailwind classes only).

- `SummaryBar`: strip above the canvas, one button per status with a non-zero count (StatusDot + count + label, order: needs you, working, idle, starting, done, exited). Wraps in the wrapper `flex h-full flex-col`; canvas is `flex-1`.
- Click a count: `picked` state sets `dim`/`hit` on node data (nodes memo depends on `filter`; layout `shape` unchanged so no refit). Dimmed = opacity 25%, hit = primary outline. Folded "+N done" chips count as hits for `done`. Click again or Esc (window listener, ignored in input/textarea such as xterm) clears. A filter whose status count hits zero clears itself.
- 'needs you' also calls `onSelect` for the first needs-you agent and `JumpTo` (inside ReactFlowProvider) does `setCenter` at max(current zoom, 0.8).
- Empty state: a single coordinator in `starting` renders "Waiting for the coordinator to spawn team leads…" instead of the canvas.
