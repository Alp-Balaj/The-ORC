# Autopilot: log why discovery failed

`Autopilot.round()` (src/main/autopilot.ts) used to swallow errors thrown by the discovery call. It now
logs them with `console.error('autopilot discovery failed', err)` and puts the message (single line,
cut to 200 chars) in the status text when the reply is null because of a thrown error:

- retry: `Discovery failed: <message>: will retry when the queue is next checked`
- stopped: `Stopped: discovery failed N time(s) in a row (<message>)`

A null reply with no thrown error (e.g. `runDiscovery` resolving null) keeps the old texts. Retry and
empty-round counting are unchanged.
