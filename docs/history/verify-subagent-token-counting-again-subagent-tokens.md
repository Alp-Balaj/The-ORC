# verify-subagent-token-counting: subagent-tokens

## What a real transcript showed
Checked `~/.claude/projects/C--Users-Alp-Documents-Projects-Personal-JobHunting/4192e0f0-....jsonl`
(a session that used the Agent tool twice).
- The main transcript has **0** `isSidechain:true` lines (112 `false`). Subagent messages are **not** in it.
- Each subagent writes its own file: `<session-id>/subagents/agent-<agentId>.jsonl` (+ `.meta.json`),
  next to `<session-id>.jsonl`. Every line there is `isSidechain:true` with `agentId`, and has normal
  `message.usage`.
- Before this change `TranscriptTally` read only the main file, so subagent tokens (the bulk of work
  in lead sessions) were never counted.

## What changed (src/main/tokens.ts)
- `TranscriptTally` keeps its API (`path`, `update()`, `count()`, `ingest()`), now backed by a per-file
  `FileReader` (own offset/partial/line counter: incremental, efficient per file).
- Each `update()` reads main, then `readdir`s `<transcript minus .jsonl>/subagents` and tails every
  `*.jsonl` there. Missing dir/file = nothing; a failing subagent file is logged and skipped.
- One shared `byMessage` map dedups by `message.id` across all files (last streaming line wins).
- `contextTokens` still comes from the main transcript only.
- Truncation of any file resets everything and re-reads all files from 0.
- New `weighted` field in `TokenCount` plus exported `COST_WEIGHTS` (input 1, output 5, cache write
  1.25, cache read 0.1). Displayed numbers (`tokens`) keep their old definition; `weighted` is not
  wired into the UI.
- Run on the real session: tokens 508151, weighted 1620038 (2 subagent files picked up).
- `pnpm typecheck` passes. Callers (`missions.ts`) unchanged.
