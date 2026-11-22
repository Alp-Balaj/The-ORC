# Mission tree: stacked, foldable, resizable

_Moved from docs/HANDOFF.md on 2026-11-22._

## Mission tree: stacked, foldable, resizable (branch `orc/the-node-tree/tree-stack`, 2026-11-22)

- **Layout:** `layoutStacked` in `src/shared/tree-layout.ts`. The coordinator and the leads sit
  side by side; each lead's workers stack in a column under it.
- **"+N done" chip:** folds a lead's finished (done or exited) workers, only when there are 2 or
  more under that lead. The selected agent is never folded. Click the chip to show them, again to
  fold.
- **Zoom:** fit-to-view never goes below 0.6 (a taller tree aligns to the top and scrolls). Below
  0.6 a node shows only its dot and name. The wheel scrolls vertically; Ctrl+wheel or a pinch
  zooms.
- **Resizable panel:** the tree/feed column defaults to 420px, clamped to 300px and 45% of the
  window (re-clamped on window resize). Drag its left edge (`data-testid=side-resize`);
  double-click resets it. The width is saved in localStorage as `orc.sideWidth`. The tree refits
  150ms after its size stops changing; the terminal refits on the next frame and tells the pty
  only when cols/rows change.
- **Replay:** `runWideTree` builds a 1+3+8 mission, checks the chip, logs rendered text sizes,
  drags the panel edge and checks the tree and terminal refit with no ResizeObserver error.
  `ORC_SMOKE_SIZE=1280x800` sets the smoke window size (default 1500x920).
- **Trap:** run the replay with `env -u ELECTRON_RENDERER_URL -u NODE_ENV_ELECTRON_VITE`, or
  it silently loads the owner's dev server instead of the build.
- **Not run yet:** the e2e check in `smoke.ts` now opens folded chips and counts folded agents.
  It's billed, so it hasn't been run.
