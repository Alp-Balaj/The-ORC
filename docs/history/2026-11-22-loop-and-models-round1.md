# Loop and models, round 1 (workflow-improvement)

_Moved from docs/HANDOFF.md on 2026-11-22._

## Backlog queue, models per role, plan-usage budget (branch `orc/workflow-improvement/loop-and-models`, 2026-11-22)

- **Backlog queue (per space)** (`src/main/queue.ts`, UI `components/QueuePanel.tsx` under each space in
  the sidebar). It's saved to `<userData>/queue.json`; smoke runs keep it in memory only.
  - **Each task is its own mission**, started with gating `none`. The title and details become the
    coordinator's first prompt (`StartMissionRequest.brief`).
  - **Stacked:** `baseBranch` is the previous queued mission's `integration/<prev>`. `mainBranch` is the
    chain's root branch, which Merge to main fast-forwards. Merging the newest mission marks the
    missions under it merged to main as well and cleans them up. A mission whose base branch was
    just merged is repointed to `mainBranch`.
  - **The queue is driven by `missions.views()`:**
    - Verdict PASS on the current integration commit, or merged to main: the item is done and the
      next one starts.
    - Red flags pause the queue with a reason: the Verifier isn't PASS or failed, the gate failed,
      any agent has a question (`ask_human`), the mission was stopped, `startMission` errored, or
      the plan-usage budget is exceeded.
    - Resume acknowledges the flags already present. An acknowledged non-PASS report counts as done,
      so the queue moves on. Pausing the queue never pauses the running mission; it only holds the
      next start.
- **Models per role** (`RoleModels`: coordinator, lead, subagent, advisor, verifier).
  - **Defaults** (`DefaultRoleModels`): sonnet, sonnet, haiku, fable, sonnet.
  - **Overrides:** the space's override (`spaces.json` `models`) applies over the defaults, and the
    mission's (New mission form → Models) over the space's. `MissionView.models` replaces the old
    `model` field.
  - **Legacy:** `req.model` (used by the tests) sets every role and turns the advisor off. Old saved
    missions keep Claude Code's defaults.
  - **Launch** (`claude-launch.ts`): `--model` gets the coordinator or lead model. The subagent model
    goes in through `--settings` `env.CLAUDE_CODE_SUBAGENT_MODEL`, and the advisor as `advisorModel`
    in `--settings`.
  - **Checked in the 2.1.330 binary:** both keys take aliases, and "fable" is one. The advisor is
    skipped, with a warning, if the main model can't use one.
- **Plan-usage budget** (`src/main/plan-usage.ts`).
  - **Status line:** every session gets a `statusLine` command that POSTs its stdin to `/hook` as
    `{hook_event_name:"OrcStatusLine", status}`. `hookEvent` hands it to `missions.statusLine`, and
    the reply becomes the status line ("ORC · plan 5h 42% · week 17%").
  - **Where the numbers come from:** `rate_limits.five_hour` and `rate_limits.seven_day` have
    `used_percentage` (0–100) and `resets_at` (epoch seconds). Subscription only, and only after a
    first API response.
  - **Pause and resume:** the queue pauses at the space's `usageThreshold` (default 80) and resumes
    on its own once the 5-hour window resets, if the weekly window is under the threshold. The
    resume time survives a restart.
  - **UI:** the sidebar footer shows the usage, with a bar.
  - **Chained with the owner's own:** `ownerStatusLine(cwd)` reads (read-only) `statusLine.command` from
    `~/.claude/settings.json`, then the project's `.claude/settings.json` and `settings.local.json` (later
    wins). The ORC's command runs it with the same stdin and prints its output, plus ` · <ORC text>` when
    the app returns some. The POST runs in the background with `curl -m 1`, errors ignored, so a slow or
    dead app delays the line by 1 s at most and never blanks it.
- **History search hooks:** `mcp__orc__search_history` is in `OrcTools`. The coordinator and lead
  prompts say to search history before reading records or docs in full.
- **Not verified live:** no billed run. Unknown:
  - whether `advisorModel` from `--settings` actually turns the advisor on;
  - whether the status-line POST arrives as expected;
  - whether `rate_limits` shows up on the owner's plan.

  The hidden replay was not run for this branch. Typecheck and every unit test in `free.sh` pass.
