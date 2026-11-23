# Loop setup UI (add-ui-to-help-with-setting-up-a-loo / loop-setup-ui, 2026-11-23)

- **What:** `LoopSetupDialog.tsx`, a modal (same shell as ShortcutsDialog) for a space's autopilot: explainer, live status
  card (state, round/empty counts, `status` line as "last round result"), 4 steps (on/off, maxTasks, maxEmptyRounds,
  usageThreshold) applied on blur/change (no Save), and a readiness checklist (queue, permission mode, usage limits known).
- **Opens from:** `openLoopSetup(root)` (window event `orc:loop-setup`), fired by "Guided loop setup…" in
  `AutopilotToggle` (space settings) and "Set up a loop" in the queue empty state (one line in QueuePanel.tsx).
  Sidebar.tsx listens and mounts the dialog. No main/IPC changes: uses `listAutopilot/onAutopilot/autopilotSet`,
  `planUsage/onPlanUsage`, `updateSpace({usageThreshold})`.
- **States:** loading, no entry yet (never run), off, idle/waiting, discovering, usage-paused (resume note), stopped
  (Restart loop = off then on), save error banner, permission mode `manual` warning, usage limits unknown.
- **Not exposed:** a structured "last round result" (only the `status` string); usage-limit readiness is inferred from PlanUsageView.
- **Brief:** Mobbin automation/settings screens ([Canny Autopilot](https://mobbin.com/screens/bc98c982-2b47-4630-b8d3-c03df7014e70), [Plane automations](https://mobbin.com/screens/7a0b56d5-6dcf-4291-a0da-dec1bf63f657), [incident.io](https://mobbin.com/screens/64e355f0-b9c9-46ea-be55-a973e6e59d91), [AirOps limits](https://mobbin.com/screens/fba4b577-c27e-4972-b354-9f8a7ece8f30)): all use a one-line explainer per setting plus a status column; we add numbered steps and a readiness list. 21st.dev not consulted (existing tokens/components reused). Not visually verified; typecheck only.
