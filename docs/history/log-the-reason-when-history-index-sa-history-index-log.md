# history-index: log non-ENOENT fs errors

`safeReaddir()` and `safeStat()` in `src/main/history-index.ts` still return `[]` / `null` on any
error, but now call `logFsError()`. ENOENT stays silent (a missing docs dir is normal on a fresh
install); any other error prints one line:
`[history-index] readdir failed for <path>: <message>` (or `stat failed for ...`).
