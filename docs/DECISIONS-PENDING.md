# Decisions pending — for the owner

Cases where the plan as written may be wrong, or needs an ADR. The build follows the plan as
written until you decide.

**Nothing is pending.** The owner decided everything below on 2026-11-22. It stays here as the
record of what was asked and what was decided.

## Decided 2026-11-22

### 1. Work merges into the integration branch without a human → accepted

[ADR 0001](adr/0001-unattended-merges-into-integration.md). **No check is the default** everywhere:
- the New mission form;
- `startMission` when no gating mode is given (it used to fall back to plan check).

Merge to main is the one human checkpoint.

### 2. Mission records (D4) → yes, without Obsidian

- On for every space.
- Plain Markdown in `<userData>/records/<repo>-<hash>/`. A space can name another folder.
- A new coordinator is given the paths of past mission notes and may read them.
- Plan § Mission records.

### 3. Restart resumes running missions → keep it, with a banner

- Running missions still come back on their own at launch.
- The window then shows "Resumed N missions after restart: …", with **Stop all** and a dismiss.
- A turn cut off by a crash still comes back idle and is not re-prompted.

### 4. Verifier → runs on its own

It runs once every team is finished and merged, once per integration commit. The button stays.
See ADR 0001.

### 5. `[The ORC]` notes typed into an idle coordinator's terminal → accepted

### 6. Smaller choices → kept as built

- **The gate command** is a per-space setting in the app's `spaces.json`. Nothing is written into
  the repo. Verified against the code 2026-11-23 and documented in
  [ADR 0002](adr/0002-gate-command-per-space-setting.md) (resolved). Correction: a new space is
  seeded with a suggested `typecheck` gate, and the gate runs in the mission's worktrees under
  `<repo>/.orc/worktrees/` (the command itself is still never written into the repo).
- **A conflict** goes back to the worker that hit it. The card shows it in red but doesn't turn ◐.
- **Merge order** is the order teams finish, not dependency order.
- **Pause** interrupts turns agents start for each other, but anything you type still runs.
- **Mission notes** use the UTC date and don't include `ask_human` answers yet.
