# Per-repo main session (mission the-main-sessions-should-be-per-repo, lead per-repo-main)

The app-level main session is now one per space (repo root).

- `MainSession` (src/main/main-session.ts) takes `repoPath`/`repoName`. Key = `mainSessionKey(repoPath)` (shared/types.ts, 16 hex chars).
  Terminal id `orc-main:<key>`, session name `orc-main-<key8>`, state file `<data>/main-sessions/<key>.json`,
  status-line dir `<data>/main-sessions/<key>/`, cwd = the repo root, own per-launch token. Always bypassPermissions.
- The old `<data>/main-session.json` and `main-session/` folder are never read (ignored, left on disk).
- index.ts: `mainSessions` map, `mainFor(root)` creates lazily; `restore()` runs for every space at launch.
  Dispatch: `mainAgentForToken`, `mainByTerminal(c)`, terminalExited/reconcile/liveSessionIds loop over all.
- Control handlers: list_missions only lists the caller's repo; start_mission refuses a different repoPath (an
  omitted/own path works); search_history searches only that repo's records and docs.
- `mainSessionPrompt(repoName, repoPath)` has no cross-repo language.
- IPC: `main:get/start/stop` take a repoPath; `main:changed` carries a `MainSessionView` with `repoPath`/`repoName`.
- Renderer: `mains` map + `mainRoot` in App.tsx; the global sidebar entry is gone, each space has a "Main session" row
  under its header. Selecting it starts that repo's session. Smoke/replay needed no change (they never touched it).
