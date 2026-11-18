# Overnight report — 2026-11-18/19

_Kept current through the night. `docs/HANDOFF.md` has the full detail._

## What was built, and how it was verified

- **M1 is done** (branch `m1/core`). The plan's M1 "done when" check is now an automated test
  (`tests/e2e.sh`), and it passed:
  - The coordinator got the two-file prompt and spawned two workers through `spawn_agent`.
  - Each worker wrote its file in its own worktree, called `report_done`, and messaged the coordinator.
  - The coordinator summarised both reports.
  - The test clicked a worker card in the hidden UI and typed Enter into its terminal. The card then
    showed "last instruction: you".
  - I checked the screenshots myself.
- **Permission prompts turn the card ◐**, and Esc turns it back. A billed scenario test checks this,
  and a free unit test (`tests/missions-status.test.ts`) replays the recorded hook payloads.
- **Answers to every "Watch for" item** are in HANDOFF:
  - worktrees inherit trust;
  - your hooks are layered, not replaced;
  - the coordinator finds deferred tools by itself;
  - permission and idle notifications have known payloads.

## Broken or unverified

- Claude Code *teams* and the MCP tool-call timeout were not looked at.
- The UI is still M1-plain (M2 is next).

## Decisions made, and why

- **Every session can take `--model`** (`StartMissionRequest.model`), applied to the whole mission.
  The tests need Haiku, and it is a reasonable product setting anyway.
- **Sessions start with a clean environment** (`sessionEnv()`). Without it, an ORC started from a
  Claude Code terminal hijacks that terminal's session messaging. This was a real bug, found by run 1.
- **`SendMessage` and `ListAgents` are pre-allowed** in every session, so mission plumbing never
  stops on a prompt.
- **Status also polls `claude agents --json`.** The plan already lists it as a backup. Hooks alone
  can't see Esc on a permission prompt.
- **Trust prompts are answered only by the test harness**, and only under `orc-sandbox`. The app
  never writes `~/.claude.json`.
- **Agent cap:** 8 per mission for now (4 in tests). The plan's per-space cap is M4.
- **Relative imports carry `.ts`**, so plain `node` can run the main-process modules in tests.

## Open questions for the owner

- **Your `notify.sh` hook fires for every ORC session** (Stop and Notification), because
  `--settings` hooks are layered on top of yours. With five workers, that is a lot of desktop
  notifications.
  - Options: leave it as it is; have the ORC set an env var such as `ORC_SESSION=1` so your script
    can skip ORC sessions; or launch with `--setting-sources` without `user`. That last one would also
    drop your permissions and plugins, which goes against "the Claude Code I use".
  - I left it as is.

## Billed sessions used

- About 11 Haiku sessions so far: the e2e test ran three times (3 sessions each), plus two
  permission runs (1 each).

## How to see it working

    cd ~/Documents/Projects/The-ORC && git switch m1/core && pnpm install
    tests/e2e.sh /tmp/orc-e2e        # ~1 min, Haiku; then look at /tmp/orc-e2e/screenshot-*.png
    pnpm dev                         # the real window: choose orc-sandbox, start a mission, talk to it
