# app-runner-log

`AppRunner.saved()` (src/main/app-runner.ts) used to swallow every error reading `app-run.json`.
Now a missing file (ENOENT) still returns null quietly; any other error (corrupt JSON, EPERM, ...)
is logged with `console.error("app runner: could not read <path>", err)` and then returns null.
