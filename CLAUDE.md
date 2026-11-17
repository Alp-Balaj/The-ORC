# The ORC

Desktop app (Electron + React + TypeScript) for running Claude Code **missions**. You talk to one
coordinator session per mission; it spawns worker sessions, each a real interactive `claude` in its
own git worktree, shown in terminals you can click into and type into.

- **The plan is `docs/PLAN.md`.** Read it before designing anything.
- **Where the build stands, and what's next, is `docs/HANDOFF.md`.** Read it at the start of every session.

## Commands

    pnpm install        # also rebuilds node-pty for Electron (postinstall)
    pnpm dev            # opens the app window (tell the user first: it appears on their desktop)
    pnpm typecheck
    pnpm build
    node --no-warnings tests/control-server.smoke.ts                 # free, no Claude involved
    node --no-warnings tests/claude-session.probe.ts <sandbox-repo>   # billed (Haiku, cents)

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
