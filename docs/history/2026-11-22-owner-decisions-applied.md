# Owner decisions applied

_Moved from docs/HANDOFF.md on 2026-11-22._

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
