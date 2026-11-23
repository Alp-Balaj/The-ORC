# Mission tree zoom controls (tree-zoom)

- `MissionTree.tsx`: the fit logic moved out of `AutoFit` into a `useFit()` hook, shared by `AutoFit` and the new `ZoomControls`.
- `ZoomControls` is a `<Panel position="bottom-left">` pill: zoom out, live % readout, zoom in, then Fit (Maximize icon). Zoom comes from `useStore(s => s.transform[2])`. The buttons disable at min/max zoom. The pill has `nopan nowheel nodrag` so it never blocks canvas pan or scroll.
- Keyboard shortcuts (+, -, 0) were skipped on purpose, to avoid firing in terminals or inputs.
- `app.css` needed no change.
