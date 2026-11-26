# worktreeStale catch now logs (stale-log)

`worktreeStale()` in `src/main/mission-git.ts` still returns `true` on any read/path error, but
the catch now logs every error except ENOENT (missing `.git` file, the normal stale case) with
`console.error`, including the repo path, the worktree dir and the error. Return values unchanged.
