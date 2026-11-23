# smoke.ts silent catches (smoke-catches)

Three empty `catch {}` blocks in `src/main/smoke.ts` no longer swallow silently:
- `log()` timeline append: comment (it can't log its own failure; entry stays in memory).
- Transcript JSON line parse: comment (blank/partial lines expected).
- Survivor SIGKILL cleanup: `log("smoke cleanup: could not SIGKILL surviving pid N: err")`.

No control-flow or result changes. `inSandbox`'s catch already returned false (untouched).
