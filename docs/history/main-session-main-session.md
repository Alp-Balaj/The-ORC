# Main session (main-session lead)

One app-level Claude Code session ("orc-main") above all missions; not a mission.

- Main: `src/main/main-session.ts` (class MainSession; own token, terminal id `orc-main`, state in
  `<userData>/main-session.json` = sessionId/wanted/launched/permissionMode; resumes at launch when
  `wanted`; only an owner Stop clears `wanted`). Never added to `Missions`, so counts, notifier and
  queue ignore it.
- Launch: `claudeArgs` with `allowTools`/`denyTools` (no Edit/Write, git writes denied);
  `mainSessionPrompt()` in `claude-launch.ts`. Permission mode = last mission's (fallback acceptEdits).
- MCP (control-server.ts, main caller only): `list_missions`, `start_mission` (existing space roots
  only); `search_history` spans all spaces for it. It messages coordinators via SendMessage.
- IPC: `main:get/start/stop`, push `main:changed`. Hooks and status poller include it.
- Renderer: pinned "Main session" row in Sidebar, terminal + header Start/Stop in App.tsx.
- Not verified live: --resume of a never-used session, stop-then-start race, SendMessage across cwd.
- No shortcut/palette entry yet.
