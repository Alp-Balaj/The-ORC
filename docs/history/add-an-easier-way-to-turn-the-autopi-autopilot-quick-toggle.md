# Autopilot quick toggle

- New `src/renderer/src/components/AutopilotSwitch.tsx`: one-click role="switch" with a state dot
  (off/idle/discovering/waiting/usage/stopped) and optional label. Tooltip = state + `AutopilotView.status`.
  Uses `listAutopilot`/`onAutopilot`/`autopilotSet(root,{enabled})`. Turning on after "stopped" resets
  empty rounds (done by backend `set()`). Errors from `autopilotSet` show as a red dot + tooltip.
  `root=null` (no space) renders it disabled.
- Placed in the Sidebar space header (always visible, even collapsed; only for enrolled spaces) and in the
  QueuePanel header row (with state label).
- Existing `AutopilotToggle` (space settings) and `LoopSetupDialog` untouched; limits stay there.
- Mobbin research was not done (brief was tight); design reuses existing tokens (primary, working, needs, faint).
- No backend/preload/type changes. `pnpm typecheck` passes.
