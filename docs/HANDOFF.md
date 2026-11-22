# Handoff — where the build stands

_Updated 2026-11-22._

History (how each piece was built, verified and debugged) lives in `docs/history/`. Find it with
the `mcp__orc__search_history` tool instead of reading the files in full. Team leads never edit
this file; they write `docs/history/<mission>-<lead>.md` instead.

## What the app does now

- **Core (M1):** coordinator + workers as real `claude` sessions in node-pty/xterm terminals, each
  worker in its own worktree; control server (MCP + hooks) on 127.0.0.1 with a token per agent.
- **UI (M2):** spaces → missions → cards, terminal centre, React Flow tree + feed right; tokens,
  steering notes to the parent, unique mission names.
- **Git (M3):** app-owned commits and merges into `integration/<mission>`, conflicts sent back to
  the worker, fast-forward Merge to main, gate command, read-only Verifier (`claude -p`).
- **Persistence (M4):** `missions.json` snapshot/restore, crash recovery with `--resume`,
  Pause/Resume, live-agent cap, mission records (on by default, `records.ts`), resume banner.
- **Owner decisions (2026-11-22):** No check is the default; the Verifier runs on its own once all
  workers are finished (ADR 0001).
- **Team leads:** coordinator → leads → subagents, prompt-only (`SpeedRules` in `claude-launch.ts`).
- **Stopping workers:** `stop_agent` for the coordinator/parent after merge; Stop on a card for
  you; Restart a stopped mission; `shutDown` is final.
- **Cards/tree:** `shownAgents()` hides exited workers; X dismisses; tree stacks workers under
  leads, folds "+N done", zooms, and the side panel is resizable.
- **Run app:** one mission's app at a time from the space's Run command, in `_integration`.
- **Terminal copy** (Ctrl+C with a selection, Ctrl+Shift+C, right-click) and **keyboard shortcuts**
  (single source: `lib/shortcuts.ts`; F1 cheat sheet).
- **Windows 11** supported (Git Bash for gates/tests, `resolveCommand()` for ConPTY).

## Next / open

- No decisions are waiting on the owner (`docs/DECISIONS-PENDING.md`, ADR 0001).
- UI polish, starting with Mobbin research.
- `ask_human` answers aren't captured in mission notes.
- Run app isn't restored after a restart of The ORC.
- A message from a sub-worker to its parent shows "last instruction: coordinator".
- Not checked live: leads fanning out to parallel subagents; the records `Read` rule working
  without a prompt; the e2e folded-chip check. Before the next billed e2e: `smoke.ts` "worker done
  again" will time out if the coordinator already ran `stop_agent` on that worker.

## Facts established (don't re-derive)

- Idle sessions wake on `SendMessage`. Mismatched permission modes hold messages, and in
  background sessions they expire.
- `--mcp-config` is variadic: the prompt goes **first** in the args.
- `claude agents --json` gives `busy`/`idle`/`waiting`; run it (and every session) with
  `sessionEnv()`, which strips the outer Claude Code session's env.
- Esc on a permission prompt fires no hook; the poller catches it.
- Our `--session-id` equals the hook `session_id` and the transcript file name.
- MCP tool calls have a hard wall-clock timeout: `propose_split` must return at once.
- Run the hidden replay with `env -u ELECTRON_RENDERER_URL -u NODE_ENV_ELECTRON_VITE`, or it loads
  the owner's dev server instead of the build.
- Node 26 runs `.ts` directly (erasable syntax only); relative imports in `src/main` carry `.ts`.
- Full list: `docs/history/facts-established.md`. Test and smoke-mode detail: `docs/history/tests.md`.
