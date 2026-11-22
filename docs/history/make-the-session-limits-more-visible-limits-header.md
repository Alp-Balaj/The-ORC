# Plan usage in the header (make-the-session-limits-more-visible / limits-header)

- New `src/renderer/src/components/PlanUsageHeader.tsx`, placed in the main header (App.tsx) before the theme toggle. It subscribes itself to `window.orc.planUsage()` / `onPlanUsage` (no main/shared changes).
- Shows compact meters: `5h` always, `wk` from 1200px wide; each has a bar, percent, and (>=1500px) `↻ time until reset`. Tooltip has full detail.
- Tones: ok (`bg-working`), warn at the space's queue threshold (`needs`), near-limit at >=95% (`destructive`). A window past its `resetsAt` shows 0%.
- Empty state: "Plan usage: waiting for data" (no fake numbers) until the first `rate_limits` arrives.
- The old sidebar `PlanUsageMeter` is left in place.
- Mobbin research skipped (brief, header-only meter; time-boxed).
