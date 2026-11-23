# integration-problems / worktree-repair

Problem: renaming the repo folder leaves each worktree's `.git` file and `.git/worktrees/<n>/gitdir` pointing at the old path; every git command there fails with "not a git repository". Plain `git worktree repair` doesn't fix it; `git worktree repair <worktree-path>` does.

Built (`src/main/mission-git.ts`):
- `repairWorktrees(repo)`: scans `<repo>/.orc/worktrees/{_orc,<mission>/*}` for dirs with a `.git` file; spawns git only if one is stale (admin dir not under `<repo>/.git/worktrees`, or its `gitdir` link doesn't match the worktree's `.git`; compared normalized, case-insensitive on Windows). Then runs `git worktree repair <stale dirs>` + `prune`. Does not take the lock; callers hold `serialized()`.
- `repairWorktreesSerialized(repo)`: lock-taking wrapper, called from `missions.restore` for each repo at startup.
- `ensureHealthyWorktree`: repair, then if `git rev-parse --git-dir` still fails, remove the dir and re-add from its branch (branch never deleted). Used for `_orc` (ensureOrcLocked) and `_integration` (ensureIntegration).
- `removeMergeWorktree` (used by all merge-worktree creation) and the create paths call `repairWorktrees` first.
- Per-worker worktrees are covered by the startup repair and the shared scan; not recreated.
