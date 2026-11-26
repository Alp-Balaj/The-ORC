# Lead progress on mission tree cards

- MissionTree.tsx: `progressOf` counts each lead's workers (all descendants) as done/crashed/needs/active. Lead cards show a 3px segmented bar (done, active, amber needs, red crashed) and `n/m` next to the status; no workers = no bar.
- "+N done" chip appends "· K crashed" (red) when any folded worker crashed.
- Expanded folded workers get `.orc-fold-in` (160ms fade/slide, app.css), only under `prefers-reduced-motion: no-preference`.
- Card size unchanged (bar is absolutely positioned at the card bottom); tree-layout.ts untouched.
