# agent-status empty catch

`readAgentStates` (src/main/agent-status.ts): the empty `catch {}` now wraps only `JSON.parse`,
catches only `SyntaxError` (anything else is rethrown), and a comment states that malformed/partial
`claude agents --json` output yields an empty states map and the poller retries next tick. The
loop that fills the map moved outside the try. No other empty catches in the file. Behavior otherwise unchanged.
