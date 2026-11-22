# Desktop notifications (add-notifications / notifications)

- `src/main/notifications.ts`: `diffViews` (pure: previous snapshot + MissionViews -> notices), `needsYouCount`, and `Notifier` (suppression, 600 ms coalescing, badge/flash). Electron is reached only through `NotifierDeps`, supplied in `src/main/index.ts`; with `ORC_SMOKE_OUT` set the show/badge/flash deps are no-ops.
- Hook: no change to missions.ts. The existing `Missions` changed-callback in index.ts also calls `notifier.onMissions(views)`.
- Events (per status/merge transition, first snapshot is baseline only, so re-emits and launch restores are silent): agent enters `needs-you` ("<agent> needs your approval · <mission>", or "has a question" + the question), worker `done`, worker diff `review`, merge `conflict`, unexpected `exited` (not shutDown/paused/stopped mission), mission merged to main. Coalesced bursts become one "N updates" notification ordered by priority (needs-you first).
- Suppressed when the window is focused and that agent (or, for mission-level events, that mission) is selected. Renderer reports selection via `ui:selection` (preload `setSelection`). Click focuses the window and sends `notify:select` (preload `onNotifySelect`); App.tsx selects the mission/agent.
- Badge: `app.setBadgeCount(needs-you count)`; `flashFrame` when the count rises while unfocused, cleared on focus.
- Setting: per-space `notifications` boolean (default true) in spaces.ts like the other space settings; checkbox in the space settings form (Sidebar.tsx, `data-testid="notifications-enabled"`). Disabled spaces produce no notices and no badge count.
- Not verified visually or with real OS notifications; typecheck and build pass.
