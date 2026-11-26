# spaces-add-cause

`Spaces.add()` (src/main/spaces.ts) used to turn any `repoRoot()` failure into "<path> is not inside a git repository".

`repoRoot` (git-worktrees.ts) runs `git rev-parse --show-toplevel` via execFile and rethrows its error unchanged. A plain non-repo gives exit code 128 / stderr "not a git repository". A missing folder gives spawn ENOENT.

Now: code 128, a "not a git repository" message, or ENOENT with a path that doesn't exist keeps the old friendly message exactly. Anything else (git missing, permissions) throws `could not check whether <path> is a git repository: <original message>` with `cause` set to the original error.
