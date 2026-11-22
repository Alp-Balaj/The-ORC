# improve-resource-usage: resource-usage lead

## Changed
- `src/main/terminals.ts`: pty scrollback is a chunk list with a running length (O(1) push, trim on overflow) instead of copying a ≤512 KB string per chunk. Same replay tail.
- `src/main/missions.ts` `emit()`: skips `missions:changed` when the serialized views equal the last sent.
- `src/main/index.ts`: `terminal:data` batched per terminal every 16 ms (exit flushes first); `missions:changed` not sent while window hidden/minimized, resent on show/restore (smoke runs always send).
- Renderer: `App.tsx` structural sharing of missions (`sameMissions`), 10 s clock paused while hidden, stable select callbacks; `MissionTree` and `Feed` wrapped in `React.memo`.
- `src/main/claude-launch.ts`: trimmed SpeedRules and prompt wording (~50-80 tokens per lead, a few dozen per subagent brief). Minor; prompts were already tight.

## Found, left alone
- `claude agents --json` spawned every 4 s while sessions are live (index.ts ~372, agent-status.ts): biggest steady cost, but slower interval changes status latency.
- `refreshTokens()` every 5 s stats every live transcript (already offset-tailing).
- State save and queue `changed()` use sync full writes (debounced / rare).
- Emit dedupe stringifies all views; per-mission diff would be cheaper.
- Disk: worktrees of stopped/failed/review workers are never pruned (`cleanupMission` removes only merged ones); `shareCodegraph` copies ~5 MB index into each worktree.
- AgentCard not memoized (renders "x ago" from the App clock). Only one xterm is mounted at a time, so there is nothing off-screen to dispose.
