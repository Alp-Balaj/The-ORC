# allow-for-parallel-task-finishing / parallel-merges

Leads finishing together no longer block each other on merges.

- `mergeIntoIntegration` (src/main/mission-git.ts) now always aborts a conflict immediately, so the
  integration worktree never holds a half-done merge and the `serialized` lock is held only briefly.
- A conflict gets its own private worktree `_merge-<worker>` on branch `orc-merge/<mission>/<worker>`
  (`startConflictMerge`), cut from the integration tip. The merge agent runs there (its cwd).
- `concludeMerge` stages/commits in that worktree (no lock), then `landMerge` takes the lock only to
  move the integration ref: `--ff-only` if integration did not move, else a `--no-ff` merge of the
  merge branch; if that conflicts too it returns `moved` and the merge restarts against the new tip
  (max 3 tries, then the old hand-back to the worker).
- `Missions.mergers` is now `missionId -> worker -> MergerState`: several merge agents run in
  parallel. A new conflict whose files overlap an active merger's files waits in that merger's
  `queue` (same "merge waits" feed line as before) and is retried via `drainMerges` when it lands/fails.
- `abortMerge` is replaced by `discardMerge`; `cleanupMission` also removes leftover merge
  worktrees/branches. Merger prompt wording updated (claude-launch.ts). Renderer state shapes unchanged.
- Facts: stale `_merge-*` worktrees after a crash are replaced the next time that worker conflicts
  (`startConflictMerge` removes leftovers first). `gitWork` (global chain) still serializes the
  orchestration steps and the gate run after a merge; that is unchanged.
