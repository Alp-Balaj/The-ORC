# ctrl-tab-fix

Bug: Ctrl+Tab and Ctrl+Shift+Tab both seemed to move up the mission list.

- Key matching in `lib/shortcuts.ts` is correct (exact modifier match incl. shift; Ctrl+Tab and Ctrl+Shift+Tab are distinct bindings).
- Cause: `App.tsx` `onKey` (nextMission/prevMission/missionN) ordered missions in raw store order, but the sidebar shows them sorted by the user's sort (`lib/missionSort.ts`, default newest first). Steps were +1/-1 over a different order than the one on screen, so direction did not match the visible list.
- Fix: `onKey` now uses `sortMissions(..., getMissionSort())` per space, same as `Sidebar.tsx`. The sort is read from localStorage at keypress (Sidebar saves it on change).
- Not verified at runtime (no UI run).
