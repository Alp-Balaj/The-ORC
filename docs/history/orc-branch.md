# The ORC branch (2026-11-23)

Why: queued missions ran in parallel, each branched from main, and Merge to main was a
fast-forward of one mission's integration branch. After the first merge, main had moved and
every other mission was refused ("main has moved since the mission started").

How it works now:
- One branch per repo, `orc-integration` (not `orc`: worker branches are `orc/<mission>/<worker>`
  and git can't hold both), with its worktree at `.orc/worktrees/_orc`. Code: `mission-git.ts`
  (`ensureOrcBranch`, `integrateIntoOrc`, `orcDiff`, `mergeOrcToMain`).
- Every new mission starts from the ORC branch (`baseBranch`); `mainBranch` is the owner's checkout
  branch. The ORC branch is fast-forwarded to main whenever it has nothing of its own.
- **Integrate** (per mission, the old merge screen) does a real `--no-ff` merge of
  `integration/<mission>` into the ORC branch. A conflict is aborted and reported
  (`mission.integrateError`). The mission keeps running; `mission.integrated.integrationCommit`
  tells whether newer work has landed since.
- Queued missions integrate on their own when the Verifier says PASS or CONCERNS. A queue item is done
  only once it is integrated, so the next one builds on it. A failed integration pauses the queue.
  Stacking queue missions on each other is gone.
- **Merge to main** (header, per repo) brings the ORC branch into the owner's main. If main has new
  commits, they are merged into the ORC branch first; if that conflicts, it's aborted and nothing
  changes. Afterwards, missions whose latest work was on the ORC branch are ended and cleared.
- Queue fix: a mission missing from the list is done, not "mission removed". Missions the queue just
  started are ignored until a missions update shows them (updates are batched), which was a
  second way to hit "Paused: mission removed".

Not done: resolving an ORC-branch conflict from inside the app (today: the error names the files).
