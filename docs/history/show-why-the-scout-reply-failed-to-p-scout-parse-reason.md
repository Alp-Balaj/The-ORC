# scout-parse-reason

`parseTasks` (src/main/autopilot.ts) now returns `{tasks} | {reason}`. Reasons: no `<tasks>` block (and no bare JSON array),
invalid JSON (with the JSON error message), not an array. The discovery caller puts the reason (single line, 200 chars) into
the 'Discovery failed: ...' / 'Stopped: ...' status and console.errors it. A thrown-error `failure` takes precedence.
