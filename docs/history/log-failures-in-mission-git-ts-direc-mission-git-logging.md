# mission-git logging

`orcWorktreeDirs` in `src/main/mission-git.ts`: the `subdirs` and `isWt` helpers now log via
`console.warn` (path, error code, error) when they fail with anything other than ENOENT (e.g.
EACCES/EPERM), then return `[]` / `false` as before. ENOENT stays silent. Same convention as
`autopilot.ts` (`console.warn`/`console.error`).
