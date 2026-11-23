# Split-approval note trimming

`SplitPanel` in `src/renderer/src/components/MissionScreens.tsx` now sends the note through a shared `decide(approve)` helper. It trims the note first, so a blank or whitespace-only note is sent as `null`. When a non-empty note is dropped because it was only whitespace, it logs `console.debug('[split] approval note was blank after trimming; ...')`. An empty, untouched note is not logged.
