# accounts-github: Accounts screen + GitHub account for Push

- **Screen:** `AccountsScreen.tsx` (modal, opened from the header Settings menu → Accounts). GitHub
  section plus a marked slot for `<ClaudeAccountsSection/>` (accounts-claude).
- **GitHub via `gh` CLI** (`src/main/github-account.ts`): status = `gh --version` + `gh auth status`
  + `gh api user`; connect = `gh auth login --web --git-protocol https` spawned with piped stdio,
  we parse the one-time code from its output, open github.com/login/device, send Enter; cancel
  kills it; disconnect = `gh auth logout`. States: missing / disconnected / connecting / connected,
  plus `error`. IPC `github:status|connect|cancel|disconnect`; preload `githubStatus` etc.
- **No tokens in the app:** gh owns the credential. Push (`pushBranch`) prefixes git with
  `-c credential.https://github.com.helper= -c credential.https://github.com.helper=!gh auth git-credential`
  when gh is signed in (cached 30s). `GIT_TERMINAL_PROMPT=0` is kept. SSH remotes are unaffected.
- Not run live (no gh login in sandbox); the code-parsing regex expects gh's
  "one-time code: XXXX-XXXX" line.
