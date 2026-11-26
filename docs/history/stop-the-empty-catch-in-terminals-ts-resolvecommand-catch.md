# resolveCommand empty catch (terminals.ts)

`resolveCommand` in `src/main/terminals.ts` no longer swallows every `statSync` error. ENOENT and
ENOTDIR (candidate doesn't exist) are skipped silently; any other error is logged with
`console.error` (same style as spaces.ts: `module: message with path:`, err) and the candidate is
still skipped. Windows resolution (candidates, order, return values) is unchanged.
