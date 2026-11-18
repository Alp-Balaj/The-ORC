# Handoff — where the build stands

_Updated 2026-11-18 night (overnight autonomous run). Morning summary: `docs/OVERNIGHT-REPORT.md`._

## Overnight run status (newest first)

- `src/main/smoke.ts`: the hidden smoke mode is now an end-to-end test (`ORC_SMOKE_PROMPT`).
  See "Smoke mode" below. `tests/kill-strays.sh` kills only ORC-launched `claude` processes.
- Every session can take `--model` (`StartMissionRequest.model`); tests use Haiku.
- `SendMessage`/`ListAgents` are pre-allowed in every session's settings.
- The trust prompt's default highlight is **"No, exit"**: answering needs ↓ then Enter.


## Done (branch `m1/core`)

| Piece | File | Verified how |
|---|---|---|
| Electron window, React UI, real terminals (node-pty + xterm.js) | `src/main/terminals.ts`, `src/renderer/src/TerminalView.tsx` | node-pty spawned a shell inside Electron's runtime (`ELECTRON_RUN_AS_NODE`) |
| Control server: HTTP MCP endpoint + hook receiver on 127.0.0.1, a token per agent, Origin refused | `src/main/control-server.ts` | `tests/control-server.smoke.ts` passes: real MCP client, 3 tools, bad name rejected, 401/403 paths |
| Launch flags for every session: name, session id, permission mode, hooks, denied git writes, MCP config, role prompt | `src/main/claude-launch.ts` | `tests/claude-session.probe.ts` passes on Claude Code 2.1.327: flags accepted, `report_done` reached the app, hooks fired `SessionStart → UserPromptSubmit → PreToolUse → PostToolUse → Stop → SessionEnd` |
| Missions: coordinator in the repo, `spawn_agent` creates a worktree under `<repo>/.orc/worktrees/<mission>/<agent>` (excluded via `.git/info/exclude`) and starts a worker | `src/main/missions.ts`, `src/main/git-worktrees.ts` | Type-checks and builds. **Not yet run end to end** |
| Three-panel UI: missions + status cards (left), terminal (centre), tree (right); clicking switches terminals, typing Enter in a terminal marks "last instruction: you" | `src/renderer/src/App.tsx` | Rendered in a hidden window under both `pnpm dev` and the build: no console errors, layout screenshot checked |
| A real interactive coordinator launched by the app with every ORC flag | `src/main/missions.ts` | Smoke mode (below): it starts and shows Claude Code's trust prompt for the never-trusted sandbox. Quitting with it live kills it cleanly (fixed a crash where exiting sessions sent to the destroyed window) |

## Next: the M1 hand test (needs the owner at the keyboard)

1. `pnpm dev`, choose `~/Documents/Projects/orc-sandbox`, name a mission, mode *Accept edits*, **Start mission**.
   **The coordinator's terminal will first ask "Is this a project you trust?"** (the sandbox was never opened interactively). Choose *Yes, I trust this folder*. Its card stays at "starting" until you do.
2. In the coordinator terminal: *"Create two files in parallel with two workers: `a.txt` saying hello and `b.txt` saying world."*
3. Expect two nodes in the tree and two cards. Click one, type to it, and check its card says "last instruction: you".
4. Both workers should end ✓ done, and the coordinator should receive their SendMessage reports.

Watch for, and record here:
- **Workspace trust in worktrees.** Does a worker in `<sandbox>/.orc/worktrees/...` start without a trust prompt? If one appears, it shows in the worker's terminal. Answer it there, and note that it happened.
- **Permission prompts → ◐.** Does a pending permission prompt fire the `Notification` hook and turn the card amber? And does an agent that is merely idle *stay* grey? Claude Code also sends a Notification after a while idle. `missions.ts` skips `notification_type: idle_prompt` and "waiting for your input", but the real payload hasn't been seen yet.
- **Every raw hook payload is logged** to `~/.config/the-orc/hooks.jsonl` (Electron `userData`). Check it for all of the above instead of relying on memory.
- **Your own hooks.** Do your personal Claude Code hooks still run in ORC sessions (are `--settings` hooks layered or replacing)?
- **Deferred tools.** In the probe, Claude needed `ToolSearch` before it could call `mcp__orc__report_done`. Check the coordinator finds `spawn_agent` unprompted. If not, strengthen `coordinatorPrompt`.

## Smoke mode (no window shown)

    pnpm build
    ORC_SMOKE_OUT=<dir> [ORC_SMOKE_REPO=~/Documents/Projects/orc-sandbox] node_modules/.bin/electron .
    # end to end (billed, Haiku, ~5 sessions):
    ORC_SMOKE_OUT=<dir> ORC_SMOKE_REPO=~/Documents/Projects/orc-sandbox \
      ORC_SMOKE_PROMPT='Create two files in parallel with two workers: a.txt containing hello, and b.txt containing world.' \
      timeout 700 node_modules/.bin/electron .; tests/kill-strays.sh

Without a prompt it loads the UI hidden and, with `ORC_SMOKE_REPO`, starts an unprompted coordinator
(not billed). With `ORC_SMOKE_PROMPT` it answers trust prompts (orc-sandbox only), types the prompt
into the coordinator, waits for workers to report done, clicks a worker card and presses Enter in
its terminal through xterm, and asserts. It always writes `report.json` (checks, timeline, states),
`screenshot-*.png`, `terminals/<agent>.txt`, `hooks.json` (this run's hook payloads),
`claude-agents.json`. Exit code 0 = pass. A watchdog kills every session at the deadline.

## Known gaps (deliberately left for later milestones)

- No `claude agents --json` fallback for status yet (hooks only).
- Missions live in memory only. Closing the app kills every session (no `--resume` reattach yet, M4).
- No commit on `report_done`, no integration branch, no merge screen (M3).
- The coordinator isn't told when the human types into a worker (plan §6, M2).
- Plain indented list as the tree. React Flow, shadcn/ui, styling polish come in M2.
- Token use on cards (read `usage` from `~/.claude/projects/<dir>/<session-id>.jsonl`), M2.

## Facts established (don't re-derive)

- Idle sessions wake on `SendMessage`. `notify_when_idle` works. Mismatched permission modes hold
  messages, and in background sessions they expire undelivered (`crossSessionInbound: "accept"` turns this off).
- A brand-new folder needs workspace trust before `claude --bg` will start there.
- `claude mcp` supports HTTP transport with headers. `--mcp-config` is variadic, so the prompt goes **first** in the args.
- pnpm 12 needs `allowBuilds` for `electron`, `node-pty`, `esbuild`. The Electron binary downloads on first run.
- Node 26 runs `.ts` directly but only erasable syntax. `--experimental-transform-types` no longer exists.
