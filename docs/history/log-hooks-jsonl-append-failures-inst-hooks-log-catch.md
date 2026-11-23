# hooks.jsonl append failures are now logged (once)

`src/main/index.ts`: the `hookEvent` handler of `ControlServer` appended raw payloads to
`<userData>/hooks.jsonl` inside an empty `catch {}`. The path is now computed once into a local
const, and the catch does `console.error('could not append to', hooksLog, err)` the first time
only (module-level `hooksLogFailed` flag), so a persistent failure like a full disk doesn't spam.
Hook routing (`mainSession.hookEvent` / `missions.hookEvent`) runs regardless of append failure.
