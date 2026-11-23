# Ready-to-merge state (renderer)

- `src/renderer/src/lib/ready.ts`: `missionReady(m)` (merged > 0, not merged to main, every worker merged/nothing, no agent starting/working/needs-you, gate and Verifier not running), `readyChecks(m)` (honest gate/Verifier text; "Verifier PASS" only when the report says `VERDICT: PASS`), per-mission "band seen" in localStorage `orc.readyBandSeen`.
- App.tsx: header Merge button is `outline` until ready, then `default` (the only filled primary). Band under the header with check icon, "All leads are done." + checks text, "Review & merge" (opens merge view) and dismiss. Hidden once dismissed or once the merge view was opened for that mission.
- Sidebar.tsx: green CircleCheck on a mission card when ready (replaces the working dot).
