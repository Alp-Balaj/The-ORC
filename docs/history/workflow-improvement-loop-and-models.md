# workflow-improvement / loop-and-models (2026-11-22)

Team lead area: backlog queue, models per role, plan-usage budget, then six round-2 fixes.

## Round 1

- **Backlog queue per space** (`src/main/queue.ts`, `components/QueuePanel.tsx`, saved in
  `<userData>/queue.json`).
  - Each task becomes its own mission: gating `none`, with the title and details as the
    coordinator's first prompt (`StartMissionRequest.brief`).
  - **Stacked:** `baseBranch = integration/<prev>`, and `mainBranch` is the chain's root.
  - **Merging the newest mission to main** marks its whole chain merged and cleans it up. Missions
    based on a just-merged integration branch are repointed to `mainBranch`.
  - **The queue is driven by `missions.views()`.** On Verifier PASS the next task starts.
  - **These pause the queue, with a reason:** a verdict other than PASS, a Verifier failure, a gate
    failure, an agent question, the mission stopped, a start error, or the usage budget. Resume
    acknowledges the flags present at that moment. Pausing the queue never pauses the running
    mission.
- **Models per role** (`RoleModels`).
  - **Defaults:** coordinator sonnet, leads sonnet, subagents haiku, advisor fable, Verifier sonnet.
  - **Overrides:** a space can override the defaults, and a mission can override its space.
  - **Launch:** `--model` for the coordinator or lead; `--settings` `env.CLAUDE_CODE_SUBAGENT_MODEL`
    for subagents; `--settings` `advisorModel` for the advisor.
  - **Legacy:** `req.model` sets every role and turns the advisor off.
- **Plan-usage budget** (`src/main/plan-usage.ts`).
  - **Data path:** the `statusLine` command in `--settings` POSTs its stdin to `/hook` as
    `{hook_event_name:"OrcStatusLine", status}`, and `missions.statusLine` handles it.
  - **Pause and resume:** the queue pauses at the space's `usageThreshold` (default 80) and resumes
    on its own after the 5-hour reset.
  - **Chained with the owner's line:** `ownerStatusLine(cwd)` reads the owner's own `statusLine`
    command (user, then project, then local settings), read-only. The ORC runs it and appends
    ` · <ORC text>`. The POST is `curl -m 1` in the background, so a dead app delays the line by 1 s
    at most.
- **`search_history`** is allowed, and the coordinator and lead prompts say to search before reading
  records.

## Round 2

1. **No false steering alerts.**
   - `isSystemPrompt()` in `missions.ts`. Prompts it catches are never "human": `<task-notification>`
     (subagent finished), prompts that are only `<system-reminder>` blocks, cross-session wrappers,
     and slash-command echoes.
   - They give no steer note to the coordinator, no "last instruction: you" and no brief capture.
2. **Auto-stop of finished leads.**
   - Space setting `idleStopMinutes`, default 15, 0 = off.
   - A 60 s check (`checkIdleStops`) stops a lead through the same path as `stop_agent` (`endAgent`,
     by `orc`). The lead must be `done`, merged or `nothing`, not in a turn, have no running
     sub-workers, and have had no activity or human input for N minutes.
   - The coordinator is never stopped this way.
3. **`add_to_queue(tasks)` MCP tool.**
   - Coordinator only, checked with `missions.callerInfo`. It appends to the space's queue
     (`Queues.addMany`).
   - `coordinatorPrompt` tells the coordinator to interview the human with grill-me for planning:
     one question at a time, each with a recommended answer, and check the code before asking. It
     uses the `.claude/skills/grill-me` skill if there is one, and offers `add_to_queue` once the plan
     is agreed.
4. **`ask_human` answers in the records.** The question is kept as `pendingQuestion`, and saved. The
   agent's next human prompt is recorded as "Question from <agent>" with `Q: … / A: …`, so
   `search_history` indexes it.
5. **Gate default.**
   - `src/main/gate-suggest.ts` suggests `<pm> typecheck` when `package.json` has a `typecheck`
     script. The package manager comes from the lockfile: pnpm, yarn, bun, or npm (`npm run`).
   - A new space is created with the suggestion as its gate. An existing space only shows it as
     `SpaceView.suggestedGate`, with a "Use" button, until the human saves.
6. **Run app after a restart.**
   - **Decision (owner, follow-up):** a "Start again" prompt instead of an automatic restart.
   - The running app (`missionId`, `command`) is saved to `<userData>/app-run.json`. It is cleared
     on an explicit stop, and kept on quit.
   - After `restore()`, `index.ts` checks the saved run: the mission exists, isn't merged to main,
     and the space still has a run command. If the run is invalid, the file is deleted. If it is
     valid, nothing is started.
   - Instead, the bottom banner area says "<mission>'s app was running before the restart" and
     offers Start again or ✕.
     - **Start again** (`app:restore-start`) runs it like Run app, with the space's current run
       command.
     - **✕** (`app:restore-dismiss`) deletes `app-run.json`.

## Facts

- **Claude Code 2.1.330:** `advisorModel` takes aliases, and `fable` is one. It is skipped, with a
  warning, if the main model has no advisor support.
- **2.1.330:** `CLAUDE_CODE_SUBAGENT_MODEL` sets the default model for Agent-tool subagents and
  works from `--settings` `env`. A model the spawn names itself still wins, unless
  `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is set.
- **Status-line stdin `rate_limits`:** `five_hour` and `seven_day` each have `used_percentage`
  (0–100) and `resets_at` (epoch seconds). They are present only for subscribers, and only after
  the first API response.
- **`--settings` `statusLine` replaces** the user's own status line, hence the chaining.
- **A finished subagent reaches its lead as a `UserPromptSubmit`** whose prompt starts with
  `<task-notification>`.
- **Not verified live (no billed runs):** the advisor actually turning on, the status-line POST in a
  real session, `rate_limits` on the owner's plan, auto-stop timing, and the Run app restore.
