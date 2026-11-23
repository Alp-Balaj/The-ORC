# gate-suggest-log

`suggestGate()` in `src/main/gate-suggest.ts` used a bare `catch { return null }`, so a malformed
or unreadable `package.json` silently produced no gate suggestion. Now: ENOENT (no package.json)
still returns null silently; any other read/parse error is logged with `console.error`
(`gate-suggest: could not read package.json in <root>; no gate suggested:`, err) and then returns
null. Return values are unchanged.
