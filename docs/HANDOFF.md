# Handoff — where the build stands

_Updated 2026-11-19 ~02:15 (overnight autonomous run). Morning summary: `docs/OVERNIGHT-REPORT.md`._

## Next

**M3 (git and gates), branch `m3/git`: built; final billed check in progress.**
- Free checks: `tests/free.sh` passes. That includes `mission-git.test.ts` (real git on throwaway
  repos), `mission-flow.test.ts` (plan check → approve → commit → merge → conflict → checkpointed
  review → gate → Verifier → merge to main) and the replay (split panel, merge screen, a real merge
  into the throwaway repo `orc-sandbox/.orc/space-b`).
- Billed, still to confirm:
  - `tests/e2e.sh` now approves the split in the UI, runs a real Verifier, clicks Merge to main, and
    checks that `a.txt`/`b.txt` land on sandbox `main`. The script resets sandbox `main` to the tag
    `orc-baseline` (4599c7a) first.
  - `ORC_SMOKE_SCENARIO=deny tests/e2e.sh <dir> "Run exactly this with Bash: git commit --allow-empty -m test"`
    checks that agents can't commit.
- If both pass: update the reports, consult the advisor, fast-forward `main`, then start M4 on `m4/robust`.

## M3: how it works

- **`src/main/mission-git.ts`:** every git call for one repo goes through a single queue, with a
  timeout and `GIT_TERMINAL_PROMPT=0`.
  - The integration worktree is `<repo>/.orc/worktrees/<mission>/_integration` on branch
    `integration/<mission>`.
  - A merge conflict is aborted, and the conflict is re-created in the *worker's* worktree for the
    worker to resolve. Its next `report_done` commits the resolution and the merge is retried.
  - Merge to main is fast-forward only. It is refused if the checkout is on another branch, dirty,
    or `main` has moved. Afterwards the app stops the sessions and removes worktrees and branches.
- **`missions.ts`:** on `report_done`, `afterDone()` commits (with an `ORC-Agent:` trailer) and then:
  - **plan / none:** merges at once, then runs the space's gate if one is set;
  - **checkpointed:** marks the worker `review`, and the human approves or sends it back.
  - Repeated or empty reports are harmless.
- **Plan check is enforced in `spawnAgent`**: it refuses until the split is approved.
  `propose_split` returns "pending" at once.
- **`deliver()`** types `[The ORC] …` into an idle agent's terminal, or else queues it as a hook
  `additionalContext` note. Prompts starting `[The ORC]` are not counted as human steering.
- **`verifier.ts`:** `claude -p` with `--tools Read,Grep,Glob --permission-mode dontAsk
  --no-session-persistence` and the mission's model, given the prompt on stdin. The template is
  pinned and its sha256 is recorded. The diff is fenced off as untrusted data.
- **Gate command:** a per-space setting in `spaces.json` (see `docs/DECISIONS-PENDING.md`).
- **UI:** `components/MissionScreens.tsx` holds `SplitPanel`, `ReviewScreen` and `MergeScreen`;
  `components/DiffView.tsx` shows diffs. The gating choice is in the New mission form.

## M2: done and verified (branch `m2/ui`, 2026-11-19 ~01:55)

- **UI:** Tailwind 4, shadcn-style primitives in `src/renderer/src/components/ui` (hand-written
  following the shadcn layout: `cn`, `components.json`), React Flow 12 tree
  (`components/MissionTree.tsx`, pure layout in `src/shared/tree-layout.ts`), Motion.
  - Layout: Spaces → Missions → cards on the left, terminal in the middle, tree plus feed on the right.
  - Header: mission tokens, Stop. Pause and Merge are disabled until M4 and M3.
- **Spaces** (`src/main/spaces.ts`): repos are saved to `<userData>/spaces.json`. In smoke mode
  they are kept in memory only.
- **Feed** (`missions.ts`), built from hooks:
  - SendMessage `PostToolUse` → `tool_response` gives `{success, message}`, so sent or failed;
  - the receiver's `<cross-session-message>` → delivered;
  - also spawn, done, question, steer and stopped.
  - Held and expired messages are **unverified** (never seen).
- **Tokens** (`src/main/tokens.ts`) are read from each hook payload's `transcript_path`.
  - `tokens` = input + cache writes + output, deduplicated by message id. Cache reads are excluded.
  - `contextTokens` = the context size on the latest turn.
- **Steering (plan §6):** when the human submits a prompt in a worker (a `UserPromptSubmit` that is
  neither the launch task nor a cross-session message), the app queues a note for the worker's
  parent.
  - The note is returned as the hook's stdout `hookSpecificOutput.additionalContext` on the
    parent's next `PreToolUse`/`UserPromptSubmit`. Both accept it on 2.1.327.
  - Verified with a real coordinator, which answered: "You typed that change to the worker
    directly, so I've left it alone."
- **Mission names** are unique across spaces, because session names are machine-wide. A name is
  also refused if `orc/<name>/` branches exist from an earlier run.
- **Stop mission** kills the mission's sessions and keeps its worktrees.
- **Tests:**
  - `tests/free.sh` runs the typecheck, 4 unit tests and the hidden replay scenario (28 UI
    checks: fake sessions, two spaces, three missions, a nested worker, every status).
  - The billed `tests/e2e.sh` now also checks tree-node clicks, steering, tokens and the feed.
    It passed (25 checks), and so did the permission scenario.

## M1: done and verified (branch `m1/core`, 2026-11-19 ~01:30)

`tests/e2e.sh <out-dir>` automates the M1 "done when" check: a hidden window and a real mission in
orc-sandbox on Haiku. Run 3 passed all 20 checks:
- The coordinator found `spawn_agent` by itself.
- Two workers spawned in `<sandbox>/.orc/worktrees/<mission>/<agent>`. Each wrote its file there
  (not in the repo root), called `report_done`, and sent `SendMessage` to the coordinator.
- The coordinator was woken by each message and summarised.
- Clicking a worker card showed that worker's terminal, and Enter typed through xterm marked
  "last instruction: you".
- The screenshots were checked by eye.

`ORC_SMOKE_SCENARIO=permission` (1 session) checks that a permission prompt turns the card ◐ and
that Esc returns it to idle.

| Piece | File | Verified how |
|---|---|---|
| Electron window, React UI, real terminals (node-pty + xterm.js) | `src/main/terminals.ts`, `src/renderer/src/TerminalView.tsx` | e2e screenshots |
| Control server: HTTP MCP endpoint + hook receiver on 127.0.0.1, a token per agent, Origin refused | `src/main/control-server.ts` | `tests/control-server.smoke.ts` (free) |
| Launch flags for every session: name, session id, permission mode, model, hooks, denied git writes, MCP config, role prompt; clean env | `src/main/claude-launch.ts` | e2e |
| Missions: coordinator in the repo; `spawn_agent` creates a worktree under `<repo>/.orc/worktrees/<mission>/<agent>` (excluded via `.git/info/exclude`) and starts a worker; cap of 8 agents per mission | `src/main/missions.ts`, `src/main/git-worktrees.ts` | e2e |
| Status from hooks plus `claude agents --json` polling | `src/main/missions.ts`, `src/main/agent-status.ts` | `tests/missions-status.test.ts` (free) + permission scenario |
| Three-panel UI: cards (left), terminal (centre), tree (right); click switches terminal; Enter marks "last instruction: you" | `src/renderer/src/App.tsx` | e2e clicks + screenshots |

### "Watch for" answers (from the e2e runs' `hooks.json` and terminal output)

- **Workspace trust in worktrees: inherited.** Once orc-sandbox was trusted, workers in
  `<sandbox>/.orc/worktrees/...` started with no trust prompt (runs 1–3).
  - The repo itself still needs trust once. The prompt highlights **"No, exit"** by default, so
    answering it takes ↓ then Enter.
  - The app does not pre-trust folders, because that would mean writing `~/.claude.json`. The user
    answers the prompt in the coordinator's terminal.
- **Permission prompts → ◐: yes, from two sources.**
  - `Notification` arrives with `notification_type: "permission_prompt"` and the message "Claude
    needs your permission", about 6 s after the prompt appears.
  - `claude agents --json` shows the session as `"status": "waiting"` sooner. The app polls it every
    4 s, and only while some agent is working or needs-you (each call takes about 0.2 s).
  - **Esc on a permission prompt fires no hook at all.** The poller sees `idle` twice and returns the
    card to idle.
- **Idle stays grey: yes.** The idle notification is `notification_type: "idle_prompt"` with the
  message "Claude is waiting for your input", about 60 s after a turn ends. The app ignores it.
- **Your own hooks: layered, not replaced.**
  - Claude Code's spinner showed "running UserPromptSubmit hooks… 0/2" and "Stop hooks… 0/2". Your
    `~/.claude/settings.json` has one hook on each of those (codegraph, notify.sh), and The ORC adds one.
  - Consequence: your `notify.sh` fires on every ORC session's Stop and Notification. See the open
    questions in OVERNIGHT-REPORT.
- **Deferred tools: fine.** The coordinator ran `ToolSearch select:mcp__orc__spawn_agent` unprompted.
  Workers loaded `report_done` and `SendMessage` the same way. The role prompts now name the tools
  and say to use ToolSearch.
- **Cross-session messages** arrive at the receiver as a `UserPromptSubmit` whose `prompt` is
  `<cross-session-message from="uds:…" from-name="<mission>/<agent>" from-mode="prompting">…`.
  - The card's activity shows "message from <agent>" from this.
  - On a worker, it also sets "last instruction: coordinator".
- **Teams: deferred.** They exist only behind `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`
  (found in the 2.1.327 binary). `spawn_agent` stays.
- **MCP tool timeout:** a hard wall-clock limit per call, set by `MCP_TOOL_TIMEOUT` (env) or a
  per-server value. Progress notifications do not extend it. So `propose_split` must return at once,
  as the plan says.
- `tests/claude-session.probe.ts` has not been rerun since the launch flags changed. `tests/e2e.sh`
  supersedes it.

### Bugs the e2e runs found, all fixed

- **Inherited session env.** Started from inside Claude Code, the app passed `CLAUDE_CODE_MESSAGING_SOCKET`,
  `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID` and the like to every session.
  - Those sessions attached to the *outer* session's messaging. Workers' SendMessage failed with "no
    agent named … is reachable", and ListAgents listed the outer session.
  - Fix: `sessionEnv()` in `claude-launch.ts` strips these variables.
- **Esc on a permission prompt left the card amber forever.** Fixed by the poller (above).
- **Hidden-window screenshots froze after the first** (Wayland). The smoke window now renders offscreen.

## Tests

    pnpm typecheck
    node --no-warnings tests/control-server.smoke.ts      # free
    tests/free.sh [out-dir]                                # free: everything below marked free + replay UI
    tests/e2e.sh <out-dir>                                 # billed: Haiku, 3 sessions, ~1 min
    ORC_SMOKE_SCENARIO=permission tests/e2e.sh <out-dir> "Use the Bash tool to run exactly this command and nothing else: python3 -c 'print(6*7)'"   # billed: 1 session
    tests/kill-strays.sh                                   # kills only ORC-launched claude processes

### Smoke mode (no window shown)

    pnpm build
    ORC_SMOKE_OUT=<dir> [ORC_SMOKE_REPO=~/Documents/Projects/orc-sandbox] node_modules/.bin/electron .

- **Without `ORC_SMOKE_PROMPT`:** loads the UI hidden. With `ORC_SMOKE_REPO`, it also starts an
  unprompted coordinator (not billed).
- **With `ORC_SMOKE_PROMPT`** (what `tests/e2e.sh` sets):
  - answers trust prompts, for orc-sandbox only;
  - types the prompt into the coordinator;
  - waits for the workers to report done;
  - clicks a worker card and presses Enter in its terminal through xterm;
  - then asserts.
- **Output, written every run:** `report.json` (checks, timeline, states), `timeline.log` (written
  as it goes), `screenshot-*.png`, `terminals/<agent>.txt`, `hooks.json` (this run's hook payloads)
  and `claude-agents.json`.
- **Exit code** 0 means pass. A watchdog kills every session at the deadline.
- `tests/e2e.sh` first removes earlier `smoke-*` worktrees and branches from the sandbox.

## Known gaps (left for later milestones)

- Missions live in memory only. Closing the app kills every session (no `--resume` reattach yet, M4).
- No commit on `report_done`, no integration branch, no merge screen (M3).
- Messages from a sub-worker to its parent show "last instruction: coordinator" (the type only knows you/coordinator).
- Worktrees and `orc/<mission>/<agent>` branches are never cleaned up by the app (M3: after merge).

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
