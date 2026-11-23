# Empty state with a real primary button (empty-state lead)

- New `components/EmptyState.tsx`: checklist (done = ticked + struck, current = highlighted, later = dimmed) and a filled `Button`: "Add repository" (`emitShortcut('spaceSettings')`) when no space, else "Start mission" (`emitShortcut('newMission')`). If the sidebar is collapsed it is reopened first (Sidebar only listens while mounted).
- `App.tsx`: first-run branch renders `<EmptyState hasRepo={spaces.length>0} hasMission={missions.length>0}>`; the right tree/feed `<aside>` is dimmed (opacity-40, pointer-events-none) until a mission exists. All testids/handlers unchanged; new testids `empty-state`, `empty-add-repo`, `empty-start-mission`.
- Refs: docs/history/first-notice-research.md rec #4 (Devin, Graphite, Stripe checklists).
