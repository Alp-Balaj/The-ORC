# Starter CLAUDE.md: only suggest a test command that exists

`createStarterClaudeMd` (src/main/onboarding.ts) used to write `${pm} test` for any detected package manager.
Now `detectTestCommand` decides:

- cargo / go: unchanged (`cargo test`, `go test ./...`).
- npm/pnpm/yarn/bun: read package.json `scripts.test`; use `${pm} test` only if it is non-empty and not the npm
  default ("no test specified"). Otherwise look for `vitest|jest|playwright.config.{ts,js,mjs,mts,cjs}` and emit
  `<runner> vitest run` / `jest` / `playwright test` (runner: `npx`, `bunx`, or `${pm} exec`).
- Anything else (uv, pip, no package.json, unreadable JSON): the `TODO: test command` placeholder.
