# accounts.json corruption handling (accounts-corrupt)

`ClaudeAccounts.init()` (src/main/claude-accounts.ts) used a bare catch, so a corrupt accounts.json looked
like a first run and the next `save()` overwrote it. Now: ENOENT is silent (fresh install); any other
read/parse error, or a parsed value that is not a plain object, is logged with `console.error` (path + error),
and the file is renamed to `accounts.json.corrupt` (a failed rename is logged, never thrown) before defaults are
used. Field shapes (accounts array, activeId string, missions object) are also validated.
