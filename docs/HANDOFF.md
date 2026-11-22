# Handoff — where the build stands

_Updated 2026-11-22._

## Next

- **No decisions are waiting on the owner.** They were all made on 2026-11-22; see
  `docs/DECISIONS-PENDING.md` and `docs/adr/0001-unattended-merges-into-integration.md`.
- **The owner has tested the app by hand.** The billed-test items listed before (e2e on the
  hardening commits, team leads live, `stop_agent` live) are no longer tracked here.
- **Open:**
  - UI polish. The owner's CLAUDE.md asks for Mobbin research first, and the Mobbin tools are now
    available.
  - Capturing `ask_human` answers for the mission notes.
  - Run app isn't restored after a restart of The ORC.
  - A message from a sub-worker to its parent shows "last instruction: coordinator".

## Backlog queue, models per role, plan-usage budget (branch `orc/workflow-improvement/loop-and-models`, 2026-11-22)

- **Backlog queue (per space)** (`src/main/queue.ts`, UI `components/QueuePanel.tsx` under each space in
  the sidebar). It's saved to `<userData>/queue.json`; smoke runs keep it in memory only.
  - **Each task is its own mission**, started with gating `none`. The title and details become the
    coordinator's first prompt (`StartMissionRequest.brief`).
  - **Stacked:** `baseBranch` is the previous queued mission's `integration/<prev>`. `mainBranch` is the
    chain's root branch, which Merge to main fast-forwards. Merging the newest mission marks the
    missions under it merged to main as well and cleans them up. A mission whose base branch was
    just merged is repointed to `mainBranch`.
  - **The queue is driven by `missions.views()`:**
    - Verdict PASS on the current integration commit, or merged to main: the item is done and the
      next one starts.
    - Red flags pause the queue with a reason: the Verifier isn't PASS or failed, the gate failed,
      any agent has a question (`ask_human`), the mission was stopped, `startMission` errored, or
      the plan-usage budget is exceeded.
    - Resume acknowledges the flags already present. An acknowledged non-PASS report counts as done,
      so the queue moves on. Pausing the queue never pauses the running mission; it only holds the
      next start.
- **Models per role** (`RoleModels`: coordinator, lead, subagent, advisor, verifier).
  - **Defaults** (`DefaultRoleModels`): sonnet, sonnet, haiku, fable, sonnet.
  - **Overrides:** the space's override (`spaces.json` `models`) applies over the defaults, and the
    mission's (New mission form → Models) over the space's. `MissionView.models` replaces the old
    `model` field.
  - **Legacy:** `req.model` (used by the tests) sets every role and turns the advisor off. Old saved
    missions keep Claude Code's defaults.
  - **Launch** (`claude-launch.ts`): `--model` gets the coordinator or lead model. The subagent model
    goes in through `--settings` `env.CLAUDE_CODE_SUBAGENT_MODEL`, and the advisor as `advisorModel`
    in `--settings`.
  - **Checked in the 2.1.330 binary:** both keys take aliases, and "fable" is one. The advisor is
    skipped, with a warning, if the main model can't use one.
- **Plan-usage budget** (`src/main/plan-usage.ts`).
  - **Status line:** every session gets a `statusLine` command that POSTs its stdin to `/hook` as
    `{hook_event_name:"OrcStatusLine", status}`. `hookEvent` hands it to `missions.statusLine`, and
    the reply becomes the status line ("ORC · plan 5h 42% · week 17%").
  - **Where the numbers come from:** `rate_limits.five_hour` and `rate_limits.seven_day` have
    `used_percentage` (0–100) and `resets_at` (epoch seconds). Subscription only, and only after a
    first API response.
  - **Pause and resume:** the queue pauses at the space's `usageThreshold` (default 80) and resumes
    on its own once the 5-hour window resets, if the weekly window is under the threshold. The
    resume time survives a restart.
  - **UI:** the sidebar footer shows the usage, with a bar.
  - **Side effect:** this replaces the owner's own status line inside ORC sessions.
- **History search hooks:** `mcp__orc__search_history` is in `OrcTools`. The coordinator and lead
  prompts say to search history before reading records or docs in full.
- **Not verified live:** no billed run. Unknown:
  - whether `advisorModel` from `--settings` actually turns the advisor on;
  - whether the status-line POST arrives as expected;
  - whether `rate_limits` shows up on the owner's plan.

  The hidden replay was not run for this branch. Typecheck and every unit test in `free.sh` pass.

## History search: `search_history` (branch `workflow-improvement/history-search`, 2026-11-22)

- **The tool:** `mcp__orc__search_history({ query, limit? })` on the control server
  (`src/main/control-server.ts`). Returns short BM25-ranked snippets (file, heading, mission, date)
  so agents check past work for a few hundred tokens instead of reading whole records.
- **Sources:** the caller's space's mission records (`spaces.recordsPath(repoPath)`, chunked per `##`
  section) and the mission repo's `docs/**/*.md` (per heading; the repo root, not the worktree).
  Code is not indexed. Indexing lives in `src/main/history-index.ts`.
- **Index:** one SQLite FTS5 db at `<userData>/history-index.sqlite` (smoke runs: the out dir), via
  `node:sqlite`, no new dependency. Created lazily on the first search (`src/main/index.ts`).
- **Freshness:** each search reindexes files whose mtime changed, so there is no watcher.
- **Allow list and prompts:** loop-and-models added `mcp__orc__search_history` to the allow list and
  told coordinators and leads to use it (`claude-launch.ts`, see the section above).

## Keyboard shortcuts (branch `ux-friendliness/shortcuts`, 2026-11-22)

- **Keys** (Mod = Cmd on macOS, Ctrl elsewhere; "app" = not while typing in a terminal or input):
  - Ctrl+Tab / Ctrl+Shift+Tab: next / previous mission. Mod+1–9: jump to mission (9 is the last).
  - Mod+Shift+N (or Mod+N, app): new mission. Mod+Shift+M: Merge to main. Mod+,: space settings.
  - Alt+↓ / Alt+↑: next / previous agent. Mod+0: coordinator. Mod+`: focus the terminal.
  - Mod+K or Mod+P (app), Mod+Shift+P: quick switcher. Mod+/ or ? (app), F1: shortcuts cheat sheet.
  - Mod+B (app), Mod+Shift+B: toggle sidebar. Mod+Shift+L: cycle theme. Escape: close dialog.
- **`lib/shortcuts.ts` is the single source of truth** (`SHORTCUTS`): the handlers, the cheat
  sheet, the palette and button tooltips (`withHint`) all read it.
- **Terminal rule:** "global" bindings fire everywhere, "app" bindings only outside terminals and
  inputs (on macOS, Mod bindings also fire in the terminal: Cmd never reaches the shell). A
  capture-phase window listener (`installGlobalShortcuts`) handles them; xterm's custom key
  handler drops matched keys so they never reach the session. Plain Ctrl+C/D/R/L/A/E/K…, arrows,
  Tab and Escape still go to the session; Ctrl+C copy is unchanged.
- **Ctrl+Tab stays Ctrl on macOS:** Cmd+Tab is the OS app switcher.

## Mission tree: stacked, foldable, resizable (branch `orc/the-node-tree/tree-stack`, 2026-11-22)

- **Layout:** `layoutStacked` in `src/shared/tree-layout.ts`. The coordinator and the leads sit
  side by side; each lead's workers stack in a column under it.
- **"+N done" chip:** folds a lead's finished (done or exited) workers, only when there are 2 or
  more under that lead. The selected agent is never folded. Click the chip to show them, again to
  fold.
- **Zoom:** fit-to-view never goes below 0.6 (a taller tree aligns to the top and scrolls). Below
  0.6 a node shows only its dot and name. The wheel scrolls vertically; Ctrl+wheel or a pinch
  zooms.
- **Resizable panel:** the tree/feed column defaults to 420px, clamped to 300px and 45% of the
  window (re-clamped on window resize). Drag its left edge (`data-testid=side-resize`);
  double-click resets it. The width is saved in localStorage as `orc.sideWidth`. The tree refits
  150ms after its size stops changing; the terminal refits on the next frame and tells the pty
  only when cols/rows change.
- **Replay:** `runWideTree` builds a 1+3+8 mission, checks the chip, logs rendered text sizes,
  drags the panel edge and checks the tree and terminal refit with no ResizeObserver error.
  `ORC_SMOKE_SIZE=1280x800` sets the smoke window size (default 1500x920).
- **Trap:** run the replay with `env -u ELECTRON_RENDERER_URL -u NODE_ENV_ELECTRON_VITE`, or
  it silently loads the owner's dev server instead of the build.
- **Not run yet:** the e2e check in `smoke.ts` now opens folded chips and counts folded agents.
  It's billed, so it hasn't been run.

## Owner decisions applied (branch `decisions-adr`, 2026-11-22)

- **No check is the default everywhere.** `startMission` without a gating mode now gives `none`
  (it used to give `plan`), and `coordinatorPrompt` defaults to it too. ADR 0001.
- **The Verifier runs on its own** (`maybeAutoVerify` in `missions.ts`):
  - **When:** after a merge, or after a report with nothing to merge, once every worker is
    done or exited with its work merged or `nothing`. A stopped worker that never committed
    counts as finished.
  - **Not when:** the mission is paused, stopped or merged to main, or the integration commit
    already has a report.
  - **Repeat runs:** `runVerifier` keeps one run per mission. A second call (the button, a test)
    waits for the running one.
  - **Billing:** every place that uses fake sessions sets a fake `verify`, so none of them can
    start a billed `claude -p`. That covers the unit tests, `ORC_SMOKE_FAKE` in `index.ts`, and
    the replay.
- **Mission records are on by default, and Obsidian is no longer involved.**
  - `vault.ts` is renamed `records.ts`.
  - **Where:** `defaultRecordsDir(<userData>/records, repo)` gives
    `<userData>/records/<repo name>-<sha1(root)[0:6]>/`. Smoke runs use `ORC_SMOKE_OUT/records`.
  - **Setting:** `vaultDir` is renamed `recordsDir` and is now an override. A `spaces.json` that
    still has `vaultDir` is read as `recordsDir`. `SpaceView.recordsPath` is the folder actually
    used, and the settings field shows it as the placeholder.
  - **Reading past notes:** the coordinator prompt lists past notes (`pastRecords`: newest 20, this
    mission's own note excluded). The coordinator gets a `Read(//<records dir>/**)` allow rule
    (`readRule` in `claude-launch.ts`; Windows paths become `//c/...`). **Not checked live:** that
    the rule lets a real session read the folder without a prompt.
- **Resume banner.**
  - `index.ts` keeps `resumedAtLaunch`: the missions whose agents `restore()` resumed or
    restarted.
  - The renderer fetches it once (`missions:resumed-at-launch`) and shows "Resumed N missions
    after restart: …" at the bottom of the window.
  - **Stop all** (`missions:stop-resumed`) stops those missions; ✕ only dismisses the banner.
  - `crash.sh` checks the banner text.
- **Tests:** `tests/free.sh` passes on Linux, including the crash tests. `mission-flow.test.ts`
  adds four checks:
  - the Verifier runs on its own;
  - No check is the default;
  - the next coordinator is told about the record;
  - it gets the Read rule.

## Copy from a terminal (branch `terminal-copy`, 2026-11-20)

- Select with the mouse, then Ctrl+C (with nothing selected it still interrupts the session),
  Ctrl+Shift+C, or right-click. `TerminalView.tsx`; the clipboard write goes through preload
  (`copyText`).
- The replay selects all through `el.orcTerm` (a test handle on the terminal element), presses
  Ctrl+C on xterm's textarea, reads the clipboard in main, then puts the owner's clipboard back.

## Run app: one mission's app at a time (branch `remove-exited-sessions`, 2026-11-20)

- **Why:** the owner runs several missions on one project and switches which one's app is
  running. The pain was the port clash: the old dev server had to be found and stopped by hand.
- **Space setting "Run command"** (`runCommand` in `spaces.json`), e.g. `pnpm install && pnpm dev`.
  The integration worktree is a fresh checkout: no `node_modules`, no gitignored `.env`.
- **Header:** Run app / Stop app, plus App to show its terminal (centre panel, with Restart). The
  mission row shows a monitor icon while its app runs.
- **`src/main/app-runner.ts`:** one app at all times. `run()` first ends the current app's whole
  process tree (`taskkill /T /F` on Windows, process group SIGTERM elsewhere) and waits up to 10 s
  for it to exit, so the new app gets the port; if it won't exit, the switch is refused with the
  reason. The command runs in Git Bash / bash `-lc` (like the gate) in
  `<repo>/.orc/worktrees/<mission>/_integration`, created from the base branch if nothing has
  merged yet. Env: `sessionEnv()` minus `ELECTRON_*`. Merges land in that worktree in place, so a
  dev server with hot reload picks them up while it runs.
- The app is stopped before Merge to main (which removes the worktree) and Remove mission, and
  on quit. It is not restored after a restart of The ORC.
- **Tests:** `tests/app-runner.test.ts` (free, in `free.sh`); the replay runs a real HTTP server on
  port 47391 in mission 2, then Run app in mission 1, and checks it got the port (no EADDRINUSE).
  Passed on Windows.

## Exited workers removed from cards and tree (branch `remove-exited-sessions`, 2026-11-20)

- **`shownAgents(mission)`** (`src/shared/types.ts`) decides which agents the cards, tree, status
  dots and terminal selection show. Nothing is deleted from state: reports, merge state, tokens
  and the feed are kept.
  - **Hidden:** an exited worker while the mission runs, one shut down on its own (any mission
    state), and one you removed with its X (`dismissed`, saved in `missions.json`).
  - **Kept:** the coordinator, a worker whose diff waits for review (its card holds Review), and in
    a stopped mission the workers Stop ended (Restart brings them back). A worker left in a
    conflict stays until you remove it.
- **X on an exited worker's card** → `Missions.dismissAgent` (refused while running or in review).
  `relaunch()` clears `dismissed`, so a worker Restart brings back shows again.
- A child whose parent is hidden is drawn as a root in the tree.
- **The open mission's row now toggles its cards** (it used to stay expanded while selected).
  The replay opens missions through `openMission()`, which only clicks a closed row.
- The replay's merge-diff check now waits for the diff instead of sleeping 900 ms (it failed once
  on Windows that way).
- Verified: `tests/free.sh` passes on Windows (replay, unit tests, crash tests).

## Team leads and speed (branch `team-leads`, 2026-11-20)

- **Owner's aim:** continuous, fast feature delivery. Testing by mission agents is not a priority.
- **Hierarchy:** coordinator → team leads → subagents (see the plan, § Hierarchy). This is prompt
  work only. Internally a lead is still `role: 'worker'`, so saved state and the git flow are
  unchanged. Prompts are in `src/main/claude-launch.ts`: `coordinatorPrompt`, `workerPrompt` (the
  lead) and `SpeedRules`, which every lead pastes into its subagents' briefs.
- **Leads are told:** start all subagents in one message, in the foreground, never isolated in a
  separate worktree (only the lead's worktree gets committed); call `report_done` only after all
  of them return; don't call `spawn_agent` (still allowed in code; the tests cover nested spawns).
- **Subagent hooks:** a subagent's tool calls fire the lead's hooks with `agent_id` set. Queued
  `[The ORC]` notes are not returned on those events (`hookEvent` in `missions.ts`), so they reach
  the lead itself.
- **New mission form defaults to No check.**
- **Not verified live:** no billed run yet. Unknown: whether leads really fan out to parallel
  subagents, whether `agent_id` arrives as expected on 2.1.327, and how subagent tool calls look
  on the card.

## Coordinator can shut down finished workers (branch `coordinator-stop-agent`, 2026-11-19)

- **`stop_agent(name, reason?)`** MCP tool, pre-approved in `OrcTools`. The coordinator prompt
  says it may use it once a worker is merged and no longer needed.
- **Who:** the coordinator, or the worker's own parent. Never itself, a sibling or the coordinator.
- **When:** only after `report_done` **and** `merge` is `merged` or `nothing`. It is refused, with
  the reason, while committing (`null`/`committed`), in `review` (may be sent back) or `conflict`
  (it must resolve), and while the worker has running sub-workers.
- **How:** the agent is set `exited` (activity "shut down by …") *before* the kill. So
  `restore()` doesn't resume it and `deliver()` types nothing into it. The report, merge state,
  worktree and branch are kept. Feed: kind `stopped`.
- **The per-mission cap of 8 now counts non-exited agents only**, so a stopped worker frees a slot.
- The e2e check "every worker reported done" now reads `doneSummary` (exited after a stop is fine).
- **Stop on a worker card (you):** a square button that shows on hover or when the card is selected.
  It opens an inline confirmation in the card ("Stop navbar?" plus one line on what happens to its
  work), not a modal. It runs `Missions.stopWorker`, which unlike `stop_agent` works at any point,
  because you decide. Unfinished changes stay uncommitted in the worktree.
  - It's refused while the worker has running sub-workers. The parent gets a queued
    `[The ORC]` note (not typed in, so no turn starts).
  - The Review screen hides Send back for a stopped worker; Approve still works.
  - UI references checked on Mobbin (stop/cancel confirmations: Zoom, Melio, Etsy, Supabase).
- **Restart a stopped mission** (header button, shown when stopped and not merged to main):
  `Missions.restartMission` relaunches every session Stop ended with the same code the crash
  restart uses (`relaunch()`, extracted from `restore()`). Agents with `shutDown` set (stopped one
  by one) stay down. It respects the space's live-agent cap.
  - It waits up to 8 s for the stopped processes to exit first. `TerminalHost.kill` only
    signals the process, and the terminal stays "running" until its exit arrives, so Restart
    right after Stop used to skip every session.
- **`shutDown` is final.**
  - The agent's token is removed, so late hooks and MCP calls are refused.
  - `hookEvent` and `restore()` ignore it.
  - A conflict when a stopped worker's approved diff merges isn't handed to the dead worker: the
    worktree is left as it was, and the feed and the coordinator are told.
- Restart (like a crash restart) brings agents back idle: an interrupted turn isn't continued.
- **Before the next billed e2e:** `smoke.ts` "worker done again" types into a finished worker. It
  will time out if the real coordinator has already stopped that worker with `stop_agent`.
- **Tests:**
  - `tests/stop-agent.test.ts` (free, in `free.sh`) covers:
    - `stop_agent` and the human stop;
    - Restart, including against a host whose kill exits late;
    - a stopped worker's diff approved cleanly, and approved into a conflict.
  - `crash.sh` now runs on Windows too (see the Windows section) and covers the `restore()`
    refactor along with `recovery.test.ts`.
  - `control-server.smoke.ts` lists and calls the tool.
  - The replay clicks Stop worker (confirmation, then the stop) and Restart: 48 checks.
  - The replay's Verifier, Merge to main and duplicate-name checks now wait for their result
    instead of a fixed sleep. Merge to main failed intermittently on Windows: the merge succeeded
    after the check had already run.
  - On Windows: typecheck, all 8 unit tests, and the replay 4 runs in a row. The billed e2e (the
    only test of a real coordinator using `stop_agent`) has not been run.

## M4: how it works

- **Persistence:** `Missions.snapshot()` and `restore()`. The state lives in
  `<userData>/missions.json` (smoke: `ORC_SMOKE_OUT/missions.json`; `ORC_STATE_FILE` overrides).
  - It is versioned and written atomically. No bearer tokens are saved.
  - Saves are frozen at quit, so killed sessions don't save as exited.
- **Recovery at start** (`index.ts`, before the window opens):
  - An orphan is killed only if its `/proc/<pid>/cmdline` holds the agent's session id.
  - A half-done merge in `_integration` is aborted.
  - Agents whose transcript exists are relaunched with `claude --resume <session-id>`, fresh tokens
    and fresh settings. Agents that never had a turn are started fresh, and workers get their task
    again.
  - A cut-off turn becomes idle. Questions and done stay as they were. A missing worktree means
    the agent is not resumed. Each of these is written to the feed.
  - Our `--session-id` equals the hook `session_id` and the transcript file name.
- **Pause / Resume:** Pause sends Esc to agents mid-turn (`inTurn`) and holds spawns, merges and
  deliveries. Resume merges the held work and flushes queued notes. The human can always type.
- **Live-agent cap** (space setting, default 6), enforced in `spawnAgent` and `startMission`.
  "Live" = the process is running and its status isn't done or exited.
- **Mission records** (`src/main/records.ts`; on by default since 2026-11-22, see above): one
  append-only note per mission. It holds the brief, approved split, worker reports, Verifier
  report (with hashes), and the merge commit plus every session id.
- **Space settings UI:** the gear on a space row holds the run command, gate command, live cap
  and records folder override, and the row shows the live count.
- **Tests:**
  - `tests/recovery.test.ts` (free, 21 checks);
  - `tests/crash.sh` (free: SIGKILL the app's process group, relaunch on the same state, fake
    sessions come back resumed);
  - `tests/resume.sh` (billed, 1 session: a real turn, Pause mid-turn, SIGKILL, relaunch, the
    session still remembers the codeword).
- `tests/kill-strays.sh` now only kills `claude` processes whose cwd is under orc-sandbox. It is
  safe while the owner runs real missions elsewhere.

## M3: done and verified (branch `m3/git`, 2026-11-19 ~02:35)

- **Billed `tests/e2e.sh` passed:**
  - the coordinator proposed a split, the test approved it in the UI, and two workers spawned;
  - the app committed and merged both into `integration/<mission>`;
  - a real Haiku Verifier gave `VERDICT: PASS`;
  - Merge to main put `a.txt`/`b.txt` on sandbox `main` (reset to the tag `orc-baseline` at the next run).
- **`ORC_SMOKE_SCENARIO=deny` passed:** an agent's `git commit` is "Not run · permission denied ·
  rule from command line arguments", with no prompt and no commit.
- **Bugs found by the billed runs:**
  - Approval lost when clicked while the coordinator was finishing its turn. Notes queued on a busy
    agent are now typed in once it stops.
  - `SessionEnd` turned done workers into exited. They now stay done.
  - The Verifier called a human-steered change "outside the brief". It is now told what the human
    typed to workers.

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
- **Gate command:** a per-space setting in `spaces.json` (decided: see `docs/DECISIONS-PENDING.md`).
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

## Windows (branch `windows-support`, 2026-11-18)

Runs on Windows 11. Checked there: typecheck, all 7 unit tests, and the hidden replay at 42/42
(twice). Not run on Windows yet: `crash.sh`, `resume.sh`, `e2e.sh` (billed). Setup: `npm i -g pnpm`
(corepack can't write to Program Files without admin), `pnpm install`, then
`node node_modules/electron/install.js` if `node_modules/electron/dist` is missing.

- `pnpm install` skips `electron-rebuild` on Windows (`scripts/rebuild-native.mjs`): node-pty's
  N-API prebuilds load in Electron, and the source build needs Visual Studio and fails on winpty.
- `repoRoot` passes git's `C:/x` through `resolve()`, so space roots match dialog and `join()` paths.
  Without it, gate lookups missed.
- Gates and the replay's fake sessions use Git for Windows' bash (`bashPath()` in `mission-git.ts`).
  A bare `bash` there is WSL.
- node-pty's ConPTY needs the program's real file (no PATH/.exe lookup), so `TerminalHost` resolves
  commands with `resolveCommand()` (PATH + PATHEXT). Without it every mission failed with
  "File not found:". The replay missed this because its fake sessions use a full bash path.
- A mission whose coordinator fails to start is now forgotten, so its name can be used again.
- `isOrphan` reads the command line through PowerShell/WMI (there's no `/proc`).
- State files are renamed with `renameOver` (retries EPERM: the virus scanner holds files briefly).
- Tests use `fileURLToPath`, not `URL.pathname` (which gives `/C:/...`).
- The `tests/*.sh` scripts run in Git Bash. `tests/proc.sh` starts and hard-kills the app:
  `setsid` and a process-group SIGKILL on Linux, `taskkill /F /T` on the job's native tree on
  Windows. `kill-strays.sh` reads each `claude.exe`'s working directory with `tests/proc-cwd.ps1`
  (from the PEB, since there's no `/proc/<pid>/cwd`). `crash.sh` passes on Windows (2026-11-19).
  `resume.sh` uses the same helpers but hasn't been run there (it's billed).
- **Test setup:** `orc-sandbox` must be trusted in `~/.claude.json`
  (`projects["C:/Users/<you>/Documents/Projects/orc-sandbox"].hasTrustDialogAccepted = true`).
  Without it a real session sits at the trust prompt and never sends SessionStart. That failure
  shows up only in the crash test's "fresh" round and in the billed tests.

## Known gaps

- Messages from a sub-worker to its parent show "last instruction: coordinator" (the type only knows you/coordinator).
- `ask_human` answers aren't captured, so mission notes don't include them.
- Run app is not restored after a restart of The ORC.

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
