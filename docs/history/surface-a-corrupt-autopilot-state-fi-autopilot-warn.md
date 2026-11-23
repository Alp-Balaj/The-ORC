# Autopilot: warn on a corrupt state file

`src/main/autopilot.ts`, `Autopilots` constructor. The catch around `readFileSync` + `JSON.parse` of `deps.file`
used to be empty, so a corrupt state file silently gave no spaces.

Now: `ENOENT` (first run) stays silent; any other failure logs
`console.warn('autopilot state file <path> is unreadable or corrupt; starting with fresh state', err)`.
The `spaces` map is cleared in the catch, so a failure part-way through loading still starts empty.
The file is not touched; it is overwritten by the next `changed()` save.

## Manual check (free, no claude sessions)

Write `{not json` to a temp file, then run a scratch .ts via `node --no-warnings`:

    import { Autopilots } from './src/main/autopilot.ts'
    const mk = (file: string) => new Autopilots({ file, queue: { list: () => [], addMany() {}, start() {} }, usageThreshold: () => 100, usage: () => null, emit() {} })
    console.log(mk('/tmp/bad.json').list().length)   // warns, prints 0
    console.log(mk('/tmp/missing.json').list().length) // silent, prints 0

Observed: the corrupt file logs the warning with the path and a SyntaxError, `list()` is empty; the missing file is silent.
