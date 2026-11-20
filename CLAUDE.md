# The ORC

Desktop app (Electron + React + TypeScript) for running Claude Code **missions**. You talk to one
coordinator session per mission; it spawns team-lead sessions, each a real interactive `claude` in
its own git worktree, shown in terminals you can click into and type into. Each lead splits its area
among Claude Code subagents that write the code (built for fast, continuous delivery: no tests
unless asked).

- **The plan is `docs/PLAN.md`.** Read it before designing anything.
- **Where the build stands, and what's next, is `docs/HANDOFF.md`.** Read it at the start of every session.

## Commands

    pnpm install        # also rebuilds node-pty for Electron (postinstall)
    pnpm dev            # opens the app window (tell the user first: it appears on their desktop)
                        # automated runs use smoke mode instead (hidden, offscreen): see docs/HANDOFF.md
    pnpm typecheck
    pnpm build
    tests/free.sh [out-dir]             # free: typecheck, unit tests, hidden UI replay, crash/quit recovery
    tests/resume.sh <out-dir>           # billed (1 Haiku session): pause mid-turn, SIGKILL, resume
    tests/e2e.sh <out-dir>              # billed (Haiku, 3 sessions): hidden window, full mission in orc-sandbox
    tests/kill-strays.sh                # after any test: kills claude processes whose cwd is in orc-sandbox
    node --no-warnings tests/claude-session.probe.ts <sandbox-repo>   # billed; superseded by e2e.sh

## Rules

- **Test against `~/Documents/Projects/orc-sandbox`**, never a real project: The ORC starts real
  Claude sessions that edit files.
- **TypeScript must stay erasable** (`erasableSyntaxOnly`): no parameter properties, enums or
  namespaces, so `node` can run any `.ts` file directly for tests.
- **pnpm 12 blocks dependency build scripts.** A new native or postinstall dependency must be added
  to `allowBuilds` in `pnpm-workspace.yaml`.
- **Agents never commit.** Every ORC session gets `permissions.deny` for git writes
  (`src/main/claude-launch.ts`). The app owns git.
- **Every session in a mission uses the same permission mode.** A mismatch makes Claude Code hold
  cross-session messages for approval, and background sessions then let them expire.
- Work on a branch, never `main`. Ask before pushing.
