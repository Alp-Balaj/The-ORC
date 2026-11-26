# pid-check-log

- Changed `isOrphan` in `src/main/index.ts` (the Windows branch asks WMI via PowerShell for a pid's command line).
- Its bare `catch` now binds `err` and logs one line via `console.error` with the pid and the error message, then still returns `false`.
- Why: a failed lookup was silently treated as "not orphan", which made the cause invisible when a session looked alive. The log line makes the failure visible without changing behavior.
- Not compiled or tested, per instructions.
