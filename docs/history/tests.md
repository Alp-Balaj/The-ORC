# Tests and smoke mode

_Moved from docs/HANDOFF.md on 2026-11-22._

## Tests

    pnpm typecheck
    node --no-warnings tests/control-server.smoke.ts      # free
    tests/free.sh [out-dir]                                # free: everything below marked free + replay UI
    tests/e2e.sh <out-dir>                                 # billed: Haiku, 3 sessions, ~1 min
    ORC_SMOKE_SCENARIO=permission tests/e2e.sh <out-dir> "Use the Bash tool to run exactly this command and nothing else: python3 -c 'print(6*7)'"   # billed: 1 session
    tests/kill-strays.sh                                   # kills only ORC-launched claude processes

## Smoke mode (no window shown)

    pnpm build
    ORC_SMOKE_OUT=<dir> [ORC_SMOKE_REPO=~/Documents/Projects/orc-sandbox] node_modules/.bin/electron .

- **Without `ORC_SMOKE_PROMPT`:** loads the UI hidden. With `ORC_SMOKE_REPO`, it also starts an
  unprompted coordinator (not billed).
- **With `ORC_SMOKE_PROMPT`** (what `tests/e2e.sh` sets):
  - answers trust prompts, for orc-sandbox only;
  - types the prompt into the coordinator;
  - waits for the workers to report done;
  - clicks a worker card and presses Enter in its terminal through xterm;
  - then asserts.
- **Output, written every run:** `report.json` (checks, timeline, states), `timeline.log` (written
  as it goes), `screenshot-*.png`, `terminals/<agent>.txt`, `hooks.json` (this run's hook payloads)
  and `claude-agents.json`.
- **Exit code** 0 means pass. A watchdog kills every session at the deadline.
- `tests/e2e.sh` first removes earlier `smoke-*` worktrees and branches from the sandbox.
