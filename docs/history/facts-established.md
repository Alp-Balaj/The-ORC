# Facts established (don't re-derive), full list

_Moved from docs/HANDOFF.md on 2026-11-22._

## Facts established (don't re-derive)

- **Messaging:**
  - Idle sessions wake on `SendMessage`, and `notify_when_idle` works.
  - Mismatched permission modes hold messages. In background sessions, held messages expire
    undelivered (`crossSessionInbound: "accept"` turns this off).
- A brand-new folder needs workspace trust before `claude --bg` will start there. Subfolders of a
  trusted folder inherit it.
- `claude mcp` supports HTTP transport with headers. `--mcp-config` is variadic, so the prompt goes
  **first** in the args.
- **`claude agents --json`:**
  - It lists interactive sessions with `status`: `busy` / `idle` / `waiting` (permission prompt),
    and background ones with `state`.
  - Run it with `sessionEnv()`.
- pnpm 12 needs `allowBuilds` for `electron`, `node-pty`, `esbuild`. The Electron binary downloads
  on first run.
- **Node 26** runs `.ts` directly, but only erasable syntax (`--experimental-transform-types` no
  longer exists). Relative imports in `src/main` carry `.ts`, so tests can import them.
