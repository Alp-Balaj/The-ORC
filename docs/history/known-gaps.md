# Known gaps (as of 2026-11-22)

_Moved from docs/HANDOFF.md on 2026-11-22._

## Known gaps

- Messages from a sub-worker to its parent show "last instruction: coordinator" (the type only knows you/coordinator).
- `ask_human` answers aren't captured, so mission notes don't include them.
- Run app is not restored after a restart of The ORC.
