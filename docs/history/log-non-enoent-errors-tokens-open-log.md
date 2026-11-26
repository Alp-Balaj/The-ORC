# tokens open log

`src/main/tokens.ts` `update()`: the `open()` catch now stays quiet for ENOENT (file not written yet) but
`console.error('tokens: could not open transcript', path, code)` for any other error. Still returns the cached count.
