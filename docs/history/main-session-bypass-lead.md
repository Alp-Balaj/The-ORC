# main-session-bypass

The app-level main session now always launches with `bypassPermissions` (fresh start, resume, restore).
- `src/main/main-session.ts`: the constructor no longer loads the saved `permissionMode` (old saved non-bypass modes are ignored; the file is rewritten with bypass on the next save), `launch()` always sets `mode = 'bypassPermissions'`, and `permissionModeInUse()` returns it.
- `src/main/index.ts`: the `permissionMode` option returns `'bypassPermissions'` instead of the last mission's mode.
- Missions started via `start_mission` use `mainSession.permissionModeInUse()`, so they inherit bypass; all sessions inside one mission still share one mode.
