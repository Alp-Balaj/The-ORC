# Log skipped unparseable lines in the tokens parse log

`TranscriptTally.ingest()` (src/main/tokens.ts) used to wrap the whole per-line body in an empty
`try { ... } catch {}`, so a malformed transcript line was dropped with no trace.

What changed:
- Malformed lines are still skipped, but each one is now logged once with `console.error`, giving
  the transcript path, the 0-based line index and the byte length (`Buffer.byteLength(line)`). Line
  contents are never logged.
- The `try` now covers only `JSON.parse`. The usage handling runs outside it. `entry` is typed as
  possibly `null` and read with `?.`, so a line holding the JSON literal `null` is still skipped
  silently, as before, instead of throwing.
- New private field `lineNo`: the index of the next complete line. It increments for every complete
  line, blank ones included, so it is the true line index in the file. It is stable across
  incremental `update()` calls because partial trailing text stays in `this.partial` and is only
  split off once its newline arrives. It is reset to 0 in `reset()`, which runs when the file
  shrinks.

Why: an unparseable line can mean a truncated or corrupted transcript, and a silent skip hides
that from whoever reads the token counts. The index and byte length are enough to find the line
without writing transcript content to the log.
