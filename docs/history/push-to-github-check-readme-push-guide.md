# push-to-github-check / readme-push-guide

Added a "Merging and pushing to GitHub" section to README.md (setup, per-mission flow, old-build troubleshooting).
Verified against: `pushBranch`/`pushRemote` in src/main/mission-git.ts (remote = `origin`, else the only remote; `git push -u <remote> refs/heads/<main>:refs/heads/<main>`, never forced), src/main/github-account.ts (`gh auth login --web`, token kept by gh), OrcMergeScreen in MissionScreens.tsx (Push button disabled without a remote).
