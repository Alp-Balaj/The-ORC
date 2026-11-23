# pnpm-fix / gate-running-flag

Bug: the space queue paused with "gate failed: <cmd> (exit ?)" though the gate passed.
Cause: `Missions.runGate` sets a placeholder gate `{ok:false, exitCode:null, output:'running…'}` before the
command finishes; `Queue.redFlag` saw `ok === false` with a new `at` and paused.

Fix: `GateView` (src/shared/types.ts) gained `running?: boolean`, set only on the placeholder. Consumers
skip running gates: `Queue.redFlag` and the start-time ack (`gateAt`), `failureOf` in types.ts, `ready.ts`,
`MissionScreens.tsx` (replaced the `output === 'running…'` string checks), and the index.ts status line.
A real failure with a null exit code (timeout/signal) has no `running` flag, so it still counts as failed.
