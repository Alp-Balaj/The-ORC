# github-check / push-after-merge

Bug: Push to GitHub lived only on the merge screen; a successful Merge to main cleared the missions, so
the screen fell back to the empty state and the human could not push.

- `missionGit.aheadOfRemote(repo, branch, remote)`: commits on branch the remote lacks (local refs only,
  no fetch; remote branch missing: commits no remote ref has). `pushTarget` now returns `ahead`.
- `MergedScreen` (MissionScreens.tsx): shown by App after a successful merge (`merged` state, view stays
  `main-merge`) with the merge message, Push to GitHub (ahead count, result/error) and Done. Cleared by an
  effect as soon as the selected mission or the view changes.
- Sidebar `SpacePush`: per-space-row button `↑ N`, shown only with a remote and N>0 unpushed commits on
  main; refreshes on window focus, after merges and after a push. Failure turns it red (message in title).
- Push is still human-click only, never forced. No Mobbin lookup (small button on existing tokens).
