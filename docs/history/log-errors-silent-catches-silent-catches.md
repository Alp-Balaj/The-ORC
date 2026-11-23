# Silent catches in app-runner.ts and mission-git.ts

- `killTree` (app-runner.ts): logs `app runner: could not kill process group` unless the error is ESRCH (group already gone).
- `AppRunner.persist` (app-runner.ts): logs `app runner: could not save app-run.json`; still never throws.
- `bashPath` (mission-git.ts): the `where.exe git` catch stays silent, with a comment (git not on PATH is expected; default path is tried next).
