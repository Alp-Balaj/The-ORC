# Team leads and speed

_Moved from docs/HANDOFF.md on 2026-11-22._

## Team leads and speed (branch `team-leads`, 2026-11-20)

- **Owner's aim:** continuous, fast feature delivery. Testing by mission agents is not a priority.
- **Hierarchy:** coordinator → team leads → subagents (see the plan, § Hierarchy). This is prompt
  work only. Internally a lead is still `role: 'worker'`, so saved state and the git flow are
  unchanged. Prompts are in `src/main/claude-launch.ts`: `coordinatorPrompt`, `workerPrompt` (the
  lead) and `SpeedRules`, which every lead pastes into its subagents' briefs.
- **Leads are told:** start all subagents in one message, in the foreground, never isolated in a
  separate worktree (only the lead's worktree gets committed); call `report_done` only after all
  of them return; don't call `spawn_agent` (still allowed in code; the tests cover nested spawns).
- **Subagent hooks:** a subagent's tool calls fire the lead's hooks with `agent_id` set. Queued
  `[The ORC]` notes are not returned on those events (`hookEvent` in `missions.ts`), so they reach
  the lead itself.
- **New mission form defaults to No check.**
- **Not verified live:** no billed run yet. Unknown: whether leads really fan out to parallel
  subagents, whether `agent_id` arrives as expected on 2.1.327, and how subagent tool calls look
  on the card.
