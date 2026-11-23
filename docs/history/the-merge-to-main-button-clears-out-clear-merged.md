# Merge to main clears out merged missions (clear-merged)

`Missions.mergeToMain` (src/main/missions.ts) now, after a successful merge and `endMerged` for the mission and its stacked chain (record notes already written), removes via `removeMission` every mission in the same repo with `mergedToMain` set and `state === 'stopped'`. Running missions and missions without `mergedToMain` stay. Worktree/branch cleanup is the existing `endMerged` → `cleanupMission`. The result carries `cleared: N` and the message ends "Cleared N merged missions."

Renderer: `MergeScreen` gets `onCleared(n)`; App clears the selection and shows a dismissible banner "Merged into main; cleared N missions" (`data-testid="merge-notice"`), since the MergeScreen unmounts with its mission.

Caveat: the queue (queue.ts) flags a running item whose mission vanished as "mission removed"; it normally sees `mergedToMain` first (awaits between), but not verified.
