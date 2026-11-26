# accounts-probe-log

`src/main/claude-accounts.ts` `probe()`: the catch around parsing `claude auth status --json` output now
`console.error`s the account id/name/configDir plus the underlying error (the exec error if present, else the
parse error) before resolving. Resolved values are unchanged.
