# Exited workers removed from cards and tree

_Moved from docs/HANDOFF.md on 2026-11-22._

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
