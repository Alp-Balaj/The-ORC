# Token audit: auxiliary agents and session lifecycle (improve-token-usage / audit-agents)

Scope: verifier.ts, autopilot.ts, gate-suggest.ts, queue.ts, agent-status.ts.

## Findings
- **gate-suggest.ts**: reads package.json only, no model call. Zero tokens.
- **agent-status.ts**: `claude agents --json` poll every 4 s, only while sessions are live; no model call. Fine.
- **Autopilot discovery** (`runDiscovery`): already Haiku + `--effort low`, read-only tools, no MCP, `--no-session-persistence`, prompt is only the known-titles list. Fine. Added `--disable-slash-commands` (drops skill/command listing from the system prompt; est. several hundred to ~2k input tokens per run).
- **Verifier**: ran with the user's model/default effort, full skill listing, and up to 60k chars (~15k tokens) of inlined diff. Changes: `--effort medium`, `--disable-slash-commands`, diff cap 60k -> 40k chars (~5k tokens less on large missions; the Verifier can Read files for the rest). Per-run saving est. 20-40% of output/thinking plus ~2-7k input tokens.
- **Verifier frequency**: already once per integration commit, and only when all workers are settled (missions.ts `maybeAutoVerify`); no redundant spawns found there.
- **queue.ts**: no direct model calls or nudges; it spawns missions only. No change.

## Not changed / suggestions (outside owned files)
- Verifier model is `mission.models.verifier` (missions.ts); defaulting it to Sonnet/Haiku would save more but is a quality call for the owner.
- `claude -p` has no `--max-turns` in this CLI version; a runaway Read loop is bounded only by the 300 s timeout.
