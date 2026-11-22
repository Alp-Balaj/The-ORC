# Coordinator can shut down finished workers

_Moved from docs/HANDOFF.md on 2026-11-22._

## Coordinator can shut down finished workers (branch `coordinator-stop-agent`, 2026-11-19)

- **`stop_agent(name, reason?)`** MCP tool, pre-approved in `OrcTools`. The coordinator prompt
  says it may use it once a worker is merged and no longer needed.
- **Who:** the coordinator, or the worker's own parent. Never itself, a sibling or the coordinator.
- **When:** only after `report_done` **and** `merge` is `merged` or `nothing`. It is refused, with
  the reason, while committing (`null`/`committed`), in `review` (may be sent back) or `conflict`
  (it must resolve), and while the worker has running sub-workers.
- **How:** the agent is set `exited` (activity "shut down by …") *before* the kill. So
  `restore()` doesn't resume it and `deliver()` types nothing into it. The report, merge state,
  worktree and branch are kept. Feed: kind `stopped`.
- **The per-mission cap of 8 now counts non-exited agents only**, so a stopped worker frees a slot.
- The e2e check "every worker reported done" now reads `doneSummary` (exited after a stop is fine).
- **Stop on a worker card (you):** a square button that shows on hover or when the card is selected.
  It opens an inline confirmation in the card ("Stop navbar?" plus one line on what happens to its
  work), not a modal. It runs `Missions.stopWorker`, which unlike `stop_agent` works at any point,
  because you decide. Unfinished changes stay uncommitted in the worktree.
  - It's refused while the worker has running sub-workers. The parent gets a queued
    `[The ORC]` note (not typed in, so no turn starts).
  - The Review screen hides Send back for a stopped worker; Approve still works.
  - UI references checked on Mobbin (stop/cancel confirmations: Zoom, Melio, Etsy, Supabase).
- **Restart a stopped mission** (header button, shown when stopped and not merged to main):
  `Missions.restartMission` relaunches every session Stop ended with the same code the crash
  restart uses (`relaunch()`, extracted from `restore()`). Agents with `shutDown` set (stopped one
  by one) stay down. It respects the space's live-agent cap.
  - It waits up to 8 s for the stopped processes to exit first. `TerminalHost.kill` only
    signals the process, and the terminal stays "running" until its exit arrives, so Restart
    right after Stop used to skip every session.
- **`shutDown` is final.**
  - The agent's token is removed, so late hooks and MCP calls are refused.
  - `hookEvent` and `restore()` ignore it.
  - A conflict when a stopped worker's approved diff merges isn't handed to the dead worker: the
    worktree is left as it was, and the feed and the coordinator are told.
- Restart (like a crash restart) brings agents back idle: an interrupted turn isn't continued.
- **Before the next billed e2e:** `smoke.ts` "worker done again" types into a finished worker. It
  will time out if the real coordinator has already stopped that worker with `stop_agent`.
- **Tests:**
  - `tests/stop-agent.test.ts` (free, in `free.sh`) covers:
    - `stop_agent` and the human stop;
    - Restart, including against a host whose kill exits late;
    - a stopped worker's diff approved cleanly, and approved into a conflict.
  - `crash.sh` now runs on Windows too (see the Windows section) and covers the `restore()`
    refactor along with `recovery.test.ts`.
  - `control-server.smoke.ts` lists and calls the tool.
  - The replay clicks Stop worker (confirmation, then the stop) and Restart: 48 checks.
  - The replay's Verifier, Merge to main and duplicate-name checks now wait for their result
    instead of a fixed sleep. Merge to main failed intermittently on Windows: the merge succeeded
    after the check had already run.
  - On Windows: typecheck, all 8 unit tests, and the replay 4 runs in a row. The billed e2e (the
    only test of a real coordinator using `stop_agent`) has not been run.
