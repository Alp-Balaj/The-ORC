# Merge agent (allow-agent-to-handle-merges / merge-agent)

A conflict when merging a worker into `integration/<mission>` is now handed to a short-lived
**merge agent** instead of the worker.

- `mission-git.ts`: `mergeIntoIntegration(..., {keepConflict})` leaves the merge in progress (markers)
  in the `_integration` worktree; `concludeMerge` (refuses while markers remain, then `add -u` + commit)
  and `abortMerge` are new. All go through the same per-repo `serialized` queue. A stale MERGE_HEAD is
  aborted at the start of every merge (crash recovery).
- `missions.ts`: `mergeWorker` split into `mergeWorker` / `startMerger` / `finishMerger` / `mergerFailed` /
  `mergedInto` / `conflictFallback` (the old worker hand-back, unchanged). The merger is a launched
  `role: 'worker'` agent named `merge-<worker>`, cwd = integration worktree, no branch, `mergerFor` set,
  prompt `mergerPrompt` (claude-launch.ts). Same permission mode and git-write deny as other sessions.
  Its `report_done` runs `finishMerger` on the `gitWork` chain: app commits the merge, runs the gate, ends
  the merger. A summary starting `CANNOT RESOLVE`, 3 reports with markers left, or the session exiting
  -> merge aborted, old behavior (worker resolves in its own worktree / human told if stopped).
- Other workers finishing meanwhile wait in the per-mission `mergers` queue and merge after.
- Feed: `conflict` entries "resolving conflict in X" / "conflict resolved". No renderer changes.
- `Missions.useMergeAgent` (default true); tests/mission-flow sets it false to cover the hand-back path.
- Not persisted: after an app restart a merger session is just a resumed worker with no state; the
  half-done merge is aborted by the next merge. Not exercised end to end (no billed run).
