# Push to GitHub (push-to-github lead)

- `mission-git.ts`: `pushRemote(repo)` (origin, else the only remote), `pushBranch(repo, branch, remote?)` runs `git push -u <remote> refs/heads/b:refs/heads/b` via the shared `git()` helper (serialized, GIT_TERMINAL_PROMPT=0, 120s timeout, never `--force`). Maps stderr to messages: no remote, rejected non-fast-forward, auth failure, unreachable.
- `missions.ts`: `pushTarget(repo)` (main branch + remote) and `pushMain(repo)`.
- IPC `orc:push-target`, `orc:push`; preload `pushTarget`, `pushToRemote`.
- UI: ghost "Push to GitHub" button under Merge to main in `OrcMergeScreen` (MissionScreens.tsx); disabled with a tooltip when no remote; inline result text like the merge result. It pushes the main branch only (after a merge it holds the merged work); the ORC branch is not pushed.
