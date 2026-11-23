# smoke-worker-wait

`src/main/smoke.ts`: the `waitFor('worker done again')` after steering now accepts worker status `'done'` or `'exited'`
(AgentStatus has no `'stopped'`; a worker stopped by the coordinator's `stop_agent` becomes `'exited'`). Check names/count unchanged.
