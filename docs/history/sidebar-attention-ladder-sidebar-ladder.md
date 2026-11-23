# Sidebar attention marker + priority ladder (Rec #8)

- `src/renderer/src/lib/attention.ts`: the single ladder error > needs > ready > working > done (`agentTier`, `missionAttention`, `topTier`, colour maps).
- Sidebar mission pill: 11px text (was 10), glow kept; red for errors, amber for needs-you. Hover title lists counts plus the first waiting question; a truncated question line shows under a collapsed mission row. Collapsed space rows get a tier dot.
- Plan-check: a pending split (`mission.split.status === 'pending'`) was NOT counted before; it now adds 1 to needs (and its summary is the hover text). No view-type change.
- Error = `merge === 'conflict'`, or a `crashed` flag if the crash-vs-clean-exit branch adds one (read loosely in `isError`; adjust there once merged).
- Not changed: header chip in App.tsx and MissionTree (outside ownership / per-agent status colours); they still count status 'needs-you' only.
