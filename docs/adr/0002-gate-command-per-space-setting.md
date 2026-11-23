# ADR 0002: The gate command is a per-space setting in spaces.json

- **Status:** accepted (verified against the code 2026-11-23)
- **Date:** 2026-11-23
- **Decided by:** the owner (DECISIONS-PENDING §6); this ADR records the verified facts

## Context

The gate is the command run on merged work before it can reach `main`. Where it is stored and who
reads it was only a one-line note in DECISIONS-PENDING §6.

## Decision

**Storage.** The command is the field `gateCommand` (`string | null`) of a space's `Settings`
(`src/main/spaces.ts`; `SpaceView` in `src/shared/types.ts`). The `Spaces` class persists every
space as one entry in `<userData>/spaces.json` (a JSON array; `Spaces.save()` writes a temp file
and renames it over). In smoke mode there is no file (in-memory). **Nothing is written into the
repo.** `Spaces.update` trims it and turns an empty string into `null`; the constructor reads it
back, treating anything that is not a non-empty string as `null`.

**Default.** `Spaces.add` seeds a new space with the suggested gate (`suggestGate` in
`src/main/gate-suggest.ts`: the repo's package.json `typecheck` script, run with the package
manager its lockfile names). For existing spaces the suggestion is only a hint
(`SpaceView.suggestedGate`, shown while `gateCommand` is null).

**Reads.**
- `Spaces.gateCommand(root)` is the one getter. `src/main/index.ts` wires it as
  `missions.gateCommandFor`, and also uses it for the `missions:run-gate` IPC.
- `Missions.mergedInto` (`src/main/missions.ts`): after each worker merges into
  `integration/<mission>`, if a gate is set it calls `Missions.runGate`, which runs it in the
  integration worktree `<repo>/.orc/worktrees/<mission>/_integration` and stores the result on
  `mission.gate`.
- The conflict-resolution path in `missions.ts` runs it in `_merge-<worker>` before accepting a
  resolution; a failing gate sends the worker back to fix it.
- Execution is `runGate` in `src/main/mission-git.ts`: `bash -lc <command>`, 10 min cap, last
  8000 chars of output kept.
- The Run button (`window.orc.runGate`, IPC `missions:run-gate`) re-runs it by hand; it needs a
  merged team.
- With no gate, merging is still allowed.

**Edit.** In the UI: the Merge-to-main screen's gate field plus Save (`MissionScreens.tsx`,
`data-testid="gate-command"`, IPC `spaces:set-gate` -> `Spaces.setGateCommand`), and the space
settings modal (`SpaceSettingsModal.tsx`, same test id, IPC `spaces:update` with
`SpacePatch.gateCommand`). Both end in `Spaces.update`, which saves and broadcasts
`spaces:changed`. `RepoDashboard.tsx` displays it.

## Consequences

The gate is per machine and per space, not versioned with the repo and not shared with
collaborators. Teams cannot override it per mission.
