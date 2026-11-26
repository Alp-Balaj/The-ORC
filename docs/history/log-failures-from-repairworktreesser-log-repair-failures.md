# log-failures-from-repairworktreesser / log-repair-failures

`restore()` in `src/main/missions.ts` used to swallow `missionGit.repairWorktreesSerialized(repo)` failures with `.catch(() => {})`.
Now the catch pushes `could not repair worktree links for <repo>: <message>` onto the `log` array that `restore()` returns
(no mission is in scope at that point, so `orcNote` is not usable; `log` is the existing reporting channel there).
Still awaited, never throws, control flow unchanged.
