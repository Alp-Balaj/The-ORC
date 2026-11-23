# Recovery log: no bare console.log

`src/main/index.ts` startup recovery printed `recovered: ...` with `console.log`. The main process has no
logger module: every other log line (silent-catch, hooks.jsonl, spaces, accounts work) uses
`console.error` / `console.warn`. A recovery summary is neither, so it now uses `console.info`
(still only printed when at least one mission was recovered). No bare `console.log` is left in `index.ts`.
