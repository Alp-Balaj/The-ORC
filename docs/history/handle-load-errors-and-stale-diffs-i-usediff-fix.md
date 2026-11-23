# useDiff: load errors and stale diffs

`useDiff` (src/renderer/src/components/MissionScreens.tsx) now:
- resets the diff to null at the start of the effect, so a changed `deps` never shows the old diff while the new one loads;
- catches a failed `load()` and sets null (only if the effect is still live), so the empty state shows and no unhandled rejection is left.

ReviewScreen's empty text changed from "Loading diff…" to "No diff to show." since it now covers both loading and failure.
