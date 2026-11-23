# accounts-claude: multiple Claude Code logins

- `src/main/claude-accounts.ts`: `claudeAccounts` singleton. Default account = plain `claude` (no
  CLAUDE_CONFIG_DIR). Added accounts get `<userData>/claude-accounts/<id>` as CLAUDE_CONFIG_DIR. Add/login runs
  `claude auth login` in a pty (URL scraped from output, optional code via `submitCode`). Status, email and plan come from
  `claude auth status --json` only; tokens are never read or copied. Persisted in `accounts.json` there.
- Every mission's sessions share one account: `configDirForMission(id)` pins the active account on first launch
  (persisted), used in `missions.ts` startSession. `sessionEnv(base, configDir?)` in `claude-launch.ts` defaults to the
  active account; verifier/autopilot/agent-status use that default.
- IPC: `claude-accounts-ipc.ts` (`registerClaudeAccountsIpc(ipcMain)`); channels `claude-accounts:` list, add, login,
  cancel-login, submit-code, set-active, rename, remove. Types: `src/shared/claude-accounts-types.ts`.
- UI: `ClaudeAccountsSection.tsx` (polls while a login runs). Needs the matching `window.orc` methods in preload (accounts-github).
- No Mobbin research was done; nothing was run live (typecheck only).
