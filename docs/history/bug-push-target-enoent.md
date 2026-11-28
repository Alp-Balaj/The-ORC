# bug-push-target-enoent
`spawn git ENOENT` from `orc:push-target` = the spawn `cwd` (repo/worktree) was deleted. `Missions.pushTarget` now returns `null` when the path is missing or git fails; preload type is nullable; MissionScreens catch rejections; `pushMain` falls back to currentBranch. `isOrphan` ignores ENOENT silently.
