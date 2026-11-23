# Log unexpected errors when killing orphans

In `src/main/index.ts`, the `kill` callback passed to `missions.restore` used to swallow every
error from `process.kill(pid, 'SIGKILL')`. It now ignores only ESRCH (process already gone) and
logs anything else (e.g. EPERM) with `console.error('orphan kill: could not kill process', pid, err)`.
Same pattern as `killTree` in `src/main/app-runner.ts`.
