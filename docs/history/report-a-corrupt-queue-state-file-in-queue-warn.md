# Queue: warn on a corrupt state file

`src/main/queue.ts`, `Queues` constructor. Mirrors the autopilot change
(`surface-a-corrupt-autopilot-state-fi-autopilot-warn.md`). The empty `catch {}` around the load now:

- stays silent on `ENOENT` (first run);
- otherwise `console.warn('queue state file <path> is unreadable or corrupt; starting with fresh state', err)`;
- clears the `queues` map so a part-way failure still starts empty.

A readable file with the wrong shape (not an object, or `queues` present but not an array) throws
`unexpected shape` and takes the same warn path. Individual malformed queue entries are still skipped silently.
The file is not touched; the next `changed()` save overwrites it. The app still starts.
