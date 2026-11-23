# Mission sorting (add-mission-sorting / mission-sorting)

- Sort control: small ArrowUpDown icon (transparent native `<select>` overlay) in the Sidebar "Spaces" header, next to Open repo. `data-testid="mission-sort"`.
- Options: Newest first (default), Oldest first, Name A–Z, Needs attention first (error/needs-you tier, then running, then stopped; ties newest first).
- Logic + persistence: `src/renderer/src/lib/missionSort.ts` (localStorage key `orc-mission-sort`, like theme/accent). Sorting is renderer-only, applied per space; the Mod+1..9 jump hints follow the sorted order. No main-process or mission behaviour changes.
