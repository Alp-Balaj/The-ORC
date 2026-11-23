# Integrate onto the ORC branch with a merge agent (mission general, orc-integrate-agent)

- `integrate(id, {detach?})` (missions.ts) -> `integrateStep`: `integrateIntoOrc` as before; on conflict it starts a
  merge agent (`startOrcMerger`) instead of refusing. Refusal + `integrateError` remain when the agent can't start,
  reports `CANNOT RESOLVE:`, leaves markers / fails the gate 3 times, exits, the mission is stopped, or the ORC branch
  moved 3 times.
- Git (mission-git.ts): `startOrcConflictMerge` makes a throwaway worktree `_merge-_orc` on branch
  `orc-merge/<mission>/_orc` from the ORC branch and merges `integration/<mission>` there (ORC worktree and the owner's
  checkout untouched). `commitOrcMerge` stages/commits (markers refused), `landOrcMerge` fast-forwards/merges the ORC
  branch to it (`moved` -> start over), `discardMerge(repo, mission, OrcMergeKey)` cleans up. `cleanupMission` already
  sweeps `orc-merge/<mission>/*`.
- Reuses `mergers` state with worker key `_orc` (`MergerState.onDone` resolves the pending result); `finishMerger` /
  `mergerFailed` branch to `finishOrcMerger` / `orcMergerFailed`. The space's `gateCommand` runs in the merge worktree
  before landing; a failure is sent back to the agent. Prompt: `orcMergerPrompt` (claude-launch.ts).
- `MissionView.integrating` (not persisted) drives the Integrate button's spinner ("Resolving conflicts…"); the feed shows
  `conflict`/`gate`/`main` entries. The IPC button awaits the whole resolution.
- MCP tool `integrate_mission` (coordinator only; control-server.ts, `missions.integrateMission`): refuses while workers
  are unmerged or the Verifier runs; returns at once with "pending" on conflict and the result arrives later as a
  `[The ORC]` message to the coordinator. Pre-approved in `OrcTools`; coordinator prompt updated.
