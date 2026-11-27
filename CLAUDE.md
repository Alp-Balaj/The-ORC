# The ORC

Desktop app (Electron + React + TypeScript) for running Claude Code **missions**. You talk to one
coordinator session per mission; it spawns team-lead sessions, each a real interactive `claude` in
its own git worktree, shown in terminals you can click into and type into. Each lead splits its area
among Claude Code subagents that write the code (built for fast, continuous delivery: no tests
unless asked).

- **The plan is `docs/PLAN.md`.** Read it before designing anything.
- **Where the build stands, and what's next, is `docs/HANDOFF.md`.** Read it at the start of every
  session (it's short: current state only). History lives in `docs/history/*.md`.
- **Search before reading in full:** `mcp__orc__search_history` indexes `docs/**/*.md` by section; use it before opening `docs/history/` or `docs/PLAN.md` whole.

## Commands

    pnpm install        # also rebuilds node-pty for Electron (postinstall)
    scripts/orc-app.sh [update]  # the owner's daily ORC: a stable copy of main (see the script)
    pnpm dev            # opens the app window (tell the user first: it appears on their desktop)
                        # automated runs: smoke mode (docs/history/tests.md)
    pnpm typecheck
    pnpm build
    tests/free.sh [out-dir]             # free: typecheck, unit tests, hidden UI replay, crash/quit recovery
    tests/resume.sh <out-dir>           # billed (1 Haiku session): pause mid-turn, SIGKILL, resume
    tests/e2e.sh <out-dir>              # billed (Haiku, 3 sessions): hidden window, full mission in orc-sandbox
    tests/kill-strays.sh                # after any test: kills claude processes whose cwd is in orc-sandbox

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

## Working on The ORC from inside an ORC mission

The owner builds The ORC with The ORC. If your system prompt says you are a coordinator or team lead
in an ORC mission, then:
- **The ORC you are running in is the owner's live app.** Never quit, kill or restart Electron or
  `claude` processes you didn't start, and never touch `~/.config/the-orc` (its state).
- **Don't run `pnpm dev` or `electron .` with a window:** the owner's ORC holds the app's
  single-instance lock, so a second copy exits at once. The owner sees your work with Run app,
  which starts a separate copy with its own data folder.
- **To see UI you changed**, use the hidden replay. It's free: fake sessions in orc-sandbox, with
  screenshots written to the out dir. First run `pnpm install && pnpm build` in your worktree,
  then `ORC_SMOKE_OUT=<dir> node_modules/.bin/electron .`. Read the PNGs it writes. Only do this
  when the brief asks you to check visually.
- **UI work starts with Mobbin research:** look at how comparable apps handle the screen or
  pattern (`mcp__claude_ai_Mobbin__*` tools, pre-approved in `.claude/settings.json`), then design.
- **Never run the billed tests** (`tests/e2e.sh`, `tests/resume.sh`, the probe).
- **Team leads never edit `docs/HANDOFF.md`.** Write your notes (what you built, how it works, facts
  established) to a new file `docs/history/<mission>-<lead>.md`; later sessions find them with
  `mcp__orc__search_history`. Only a dedicated docs pass refreshes HANDOFF.
