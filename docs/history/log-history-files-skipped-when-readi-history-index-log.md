# Log history files skipped when reading (history-index lead)

## What changed

- `src/main/history-index.ts`, `refresh()` index loop: the `catch` around `readFileSync` now binds the error and calls `console.error` with the file path and message, then still `continue`s to the next file.
- `ENOENT` stays silent: a file that disappeared between the directory walk and the read is expected, not a fault.

## Why

An unreadable transcript (permissions, locked file, I/O error) was dropped from search with no trace, so a missing hit could not be explained. The file is still skipped, so search keeps working for the other files.

## Notes

- The file has no other logging, so the message uses a plain `history-index:` prefix.
- Only the index loop changed. `safeStat` and `safeReaddir` still swallow errors silently; they were out of scope.
