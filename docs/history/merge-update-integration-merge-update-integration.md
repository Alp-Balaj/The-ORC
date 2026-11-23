# Update the ORC branch from main (mission offer-to-update-integration-from-mai, merge-update-integration)

Brief assumed a per-mission `integration/<mission>` fast-forward-only merge; the code is now on the ORC-branch model (`mergeOrcToMain` already merges main into `orc-integration` itself and only blocks on a conflict or a dirty/wrong-branch checkout).

- `mission-git.ts` `updateOrcFromMain(repo, main)`: merges main into the ORC branch in its worktree (serialized). Conflict: `merge --abort`, files reported, no markers ever committed.
- `missions.ts` `updateFromMain(repo)`, IPC `orc:update-from-main`, preload `updateFromMain`.
- `OrcMergeScreen`: after a failed Merge to main, an "Update orc-integration from main" button (`data-testid=update-from-main`); its result replaces the message; on success Merge to main works again.
- Not done: handing a conflict to a merge agent. The existing ORC merge agent is tied to merging a mission's integration branch (`startOrcMerger`/`finishOrcMerger`), so the conflict is reported and aborted instead.
