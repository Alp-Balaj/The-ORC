# improve-token-usage: audit of context injection and history

## Findings
- **Coordinator prompt record list** (`pastRecords`, injected by `coordinatorPrompt`): was capped at 20 absolute paths
  (~100-130 chars each, ~600-800 tokens), re-sent on every coordinator turn (cached, but it still counts as context).
  Now capped at 5 (~150-200 tokens): saves ~500 tokens per coordinator session. Older records stay reachable through
  `mcp__orc__search_history`, which the prompt already steers to first. Further idea (not done, `claude-launch.ts` is
  another audit's file): print the records dir once plus bare filenames; saves ~another 60%.
- **CLAUDE.md** (loaded by every session and subagent): 4.2 KB (~1,000 tokens) and already lean. Trimmed ~200 bytes
  (dropped the superseded probe line, merged wrapped lines); every rule kept. Not worth more cutting.
- **Docs size** (read only on demand): PLAN.md 19.7 KB, OVERNIGHT-REPORT.md 10 KB, DECISIONS-PENDING.md 2.3 KB,
  docs/history 147 files / 558 KB. All reached through `search_history` (section-level snippets), so none is loaded
  by default; no change needed. CLAUDE.md already says search before reading in full.
- **codegraph.ts** only copies the index into worktrees; the guidance to use CodeGraph lives in the user's global
  CLAUDE.md and the `search_history` "code is not indexed, use CodeGraph" hint. Adequate; no change.
