# log-the-reason-when-autopilot-state / autopilot-load-log

No code change was needed in `src/main/autopilot.ts`.

- The autopilot state load (`Autopilots` constructor, ~line 157-175) already does this: ENOENT (first run) is silent, any other
  failure (unreadable file or JSON parse error) is logged with `console.warn` including the file path and the error, then state is
  cleared (fresh state).
- The bare `catch { return null }` at ~line 50 is not the state load. It is in the discovery-reply parser: `JSON.parse` of the model's
  reply. ENOENT does not apply there, and a null return on an unparseable reply is the intended contract, so it was left alone.
