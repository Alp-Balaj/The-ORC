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

- **M2 is done** (branch `m2/ui`, fast-forwarded to `main`):
  - Spaces → Missions → cards; a React Flow tree with live state and message edges; the message
    feed; token counts; Stop mission; several missions and spaces.
  - Typing into a worker now tells its coordinator. A real Haiku coordinator replied "You typed
    that change to the worker directly, so I've left it alone."
  - Verified by `tests/free.sh` (a free hidden-UI replay with 28 checks) and the billed e2e
    (25 checks). I checked the screenshots by eye.

- **M3 is done** (branch `m3/git`, fast-forwarded to `main`):
  - The app commits each worker on `report_done` and merges into `integration/<mission>` in its own
    worktree; your checkout is never touched until you click.
  - A conflict goes back to the worker to resolve (the markers are left in its worktree), and the
    coordinator is told.
  - Gating modes: plan check (enforced, using `propose_split` and an approval panel), checkpointed
    (a review screen per worker) and no check.
  - A per-space gate command.
  - The Merge to main screen: combined diff, gate, Verifier, and a fast-forward-only merge that
    refuses a dirty checkout or a moved `main`.
  - Verified by:
    - free tests on real git (`mission-git`, `mission-flow`) and the hidden-UI replay;
    - the billed e2e: split approved in the UI → merged → Verifier PASS → Merge to main;
    - a billed check that an agent's `git commit` is denied;
    - a billed real conflict: two workers wrote the same file, the second was handed the conflict,
      resolved it and merged.
  - The billed runs found five bugs, all fixed:
    - a split approval was lost when clicked mid-turn;
    - done workers were reset to exited;
    - the Verifier judged steering to be outside the brief;
    - a done worker's permission prompt never showed ◐;
    - Merge to main deleted unmerged workers' worktrees (found by review).

- **M4 is done** (branch `m4/robust`):
  - **Crash recovery:** missions persist, and on start every live agent reattaches with
    `claude --resume`. Verified free by SIGKILLing the app mid-mission and relaunching.
    Verified billed: a real session paused mid-turn, the app was killed, and after the relaunch
    the same session answered "PELICAN", a codeword given before the crash. Confirmed from the
    transcript.
  - **Pause / Resume:** Esc to agents mid-turn; spawns, merges and messages held. Verified on a
    real session.
  - **Live-agent cap per space** and **space settings** (gate, cap, records folder).
  - **Mission records (vault):** off by default, since D4 is open.
  - Tests: `tests/recovery.test.ts`, `tests/crash.sh` (free), `tests/resume.sh` (billed).

## Broken or unverified

- Claude Code *teams* are experimental (behind an env flag), so I deferred them. The MCP tool-call
  timeout is a hard limit (`MCP_TOOL_TIMEOUT`), which confirms the plan's "propose_split returns
  pending".
- Held and expired message states (permission-mode mismatch) are never shown in the feed, because
  they never occur when every session uses the same mode.
- **Mission records are tested only against a folder inside orc-sandbox.** Nothing was written to
  your real vault.
- **A crash during a worker's first turn** restarts that worker fresh, with its task again.
- Merge to main fails when `main` has moved since the mission began. It says so, but it doesn't
  offer to update the integration branch.

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
- **shadcn/ui components are hand-written** in shadcn's own file layout instead of generated by its
  CLI. That avoids an interactive or network step overnight, and the result is the same kind of code.
- **React Flow 12.12.1, not 13**: version 13 came out days ago. Every new dependency is pinned to a
  release at least a week old.
- **Mission names are unique across all spaces.** Claude Code session names are machine-wide, so
  two missions with the same name would mix up their messages.
- **Relative imports carry `.ts`**, so plain `node` can run the main-process modules in tests.

## Open questions for the owner

- **`docs/DECISIONS-PENDING.md`** has three items:
  - the ADR the plan asks for: plan check auto-merges into integration;
  - typing `[The ORC] …` notices into an idle coordinator's terminal;
  - where the gate command lives.

- **Your `notify.sh` hook fires for every ORC session** (Stop and Notification), because
  `--settings` hooks are layered on top of yours. With five workers, that is a lot of desktop
  notifications.
  - Options: leave it as it is; have the ORC set an env var such as `ORC_SESSION=1` so your script
    can skip ORC sessions; or launch with `--setting-sources` without `user`. That last one would also
    drop your permissions and plugins, which goes against "the Claude Code I use".
  - I left it as is. **Tonight's test sessions ran through `notify.sh` too** (it sends a desktop
    notification on Stop unless that session's window has focus), so you may find a pile of
    notifications from the test runs.

## Billed sessions used

- About 47 Haiku sessions so far, all small: the e2e test ran 7 times (3–4 sessions each), the
  permission scenario 4 times, the deny check once, and the Verifier 3 times.

## How to see it working

    cd ~/Documents/Projects/The-ORC && git switch main && git pull && pnpm install
    tests/free.sh /tmp/orc-free      # free; screenshots in /tmp/orc-free/replay
    tests/e2e.sh /tmp/orc-e2e        # ~1 min, Haiku; then look at /tmp/orc-e2e/screenshot-*.png
    pnpm dev                         # the real window: choose orc-sandbox, start a mission, talk to it
