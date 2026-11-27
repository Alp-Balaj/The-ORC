# improve-token-usage / audit-prompts

## Done (src/main/claude-launch.ts)
Tightened wording in `coordinatorPrompt` (intro, lead description, stop_agent, grill-me, past-records
text) and `workerPrompt` (merged duplicate "work only in worktree" lines, shorter report_done/conflict
text). No rule or behaviour removed. Saving: coordinator ~45 tokens, lead ~25 tokens per session
(prompts are ~700 and ~330 tokens, so ~6% and ~8%).
`main-session.ts` holds no prompt text (only `mainSessionPrompt` call), nothing to change.

## Found, not done
- `mergerPrompt` / `orcMergerPrompt` share ~80% of their text; a shared helper would cut source
  duplication but not tokens per session (each session sees one). Merge agents are short-lived.
- `SpeedRules` is repeated by every lead in every subagent brief (~45 tokens x subagents). Cannot be
  removed (subagents don't see the system prompt); could be delivered via a project CLAUDE.md/agent
  definition instead, but that changes behaviour surface.
- The `--settings` JSON repeats the full hook command 7x (curl + token) in launch args: not model
  tokens, no cost.
- Leads' system prompt repeats the Agent-tool/ToolSearch guidance partly in the first message
  (spawn brief, owned by other code); check the first-prompt builder in missions.ts for duplication.
