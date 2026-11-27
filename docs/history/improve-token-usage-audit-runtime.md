# improve-token-usage / audit-runtime

Scope: app-side token accounting, plan usage, polling, per-role model defaults. No code changed.

## Accounting (`src/main/tokens.ts`)
- `tokens` = input + cache_creation + output, de-duplicated by `message.id` (streaming lines: last wins). Correct, and the UI label says "input + cache writes + output". Cache reads are excluded on purpose (they are cheap and would swamp the number); `contextTokens` (input + cache writes + cache reads of the latest message) is the context-in-use figure. OK.
- Gap 1: subagent (Agent-tool) usage is only counted if Claude Code writes sidechain messages into the main transcript. If a Claude Code version writes subagents to separate files, mission totals undercount subagent spend. Not verifiable without a live run; worth a check against a real transcript.
- Gap 2: the tally is created once, on the first hook event (`missions.ts:967`, `if (!agent.tally ...)`). If a resume ever gives a new `transcript_path`, the old path keeps being read. A resume that copies history into a new file would double count only if the tally were re-created; it is not, so no double counting today.
- Cost-weighted view is absent: 1 cache-write token and 1 output token display equally. Optional future improvement, not applied.

## Polling
- `refreshTokens` runs every 5 s (`index.ts:615`): one open+stat+close per live agent, reads only appended bytes. Negligible; emits only on change. No change needed.
- `PlanUsage` is push-driven from the status line and throttled to 2 s; no polling. OK.

## Model defaults (`DefaultRoleModels`, `src/shared/types.ts:216`)
coordinator sonnet, lead sonnet, subagent haiku, advisor fable, verifier sonnet.
- Verifier request (from coordinator / audit-agents): NOT changed. The verifier decides whether work is correct; a weaker model risks false passes that cost a full rework cycle, and the owner set these defaults deliberately on 2026-11-22. The file is also outside my ownership. It is a per-space/mission override already (`models.verifier`), so the owner can pick haiku where acceptable. If the owner wants it, change the one literal.
- Advisor 'fable' is the most expensive role, but advisor calls are few; keep.

## Needs claude-launch.ts (not edited)
Candidates for the launch audit: `--effort` per role (leads/coordinator at medium or low), `CLAUDE_CODE_DISABLE_...` flags and `ENABLE_TOOL_SEARCH`/MCP trimming for spawned sessions, auto-compact threshold (`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`), and keeping the system-prompt/settings prefix byte-stable per session to preserve prompt cache. `claude-launch.ts` already passes `--model` and `CLAUDE_CODE_SUBAGENT_MODEL`; no effort or compaction setting is applied to interactive sessions (only autopilot uses `--effort low`).
