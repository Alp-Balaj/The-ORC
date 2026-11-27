# Verifier runaway guard (verifier-guard)

- `claude --help` has `--max-budget-usd` but no `--max-turns`. `src/main/verifier.ts` now uses it ($3 backstop) AND
  runs with `--output-format stream-json --verbose`, parsing events line by line.
- Own guard: kill (SIGKILL) after >40 tool_use blocks, or when the same tool+input repeats 3 times. 300 s timeout kept.
- A trip returns `{ok:false, report:'Verifier stopped by runaway guard: <reason>.'}` and logs `[verifier] runaway guard tripped` via console.error.
  Spawn errors, unparseable lines and non-success `result` events are also logged.
- Success needs a `result` event with subtype `success`; report text = its `result` (fallback: last assistant text).
- Default Verifier model untouched (owner decision pending). Not run or tested (no billed runs).
