# clearup / sidebar-declutter

Decluttered the left sidebar (Sidebar.tsx, QueuePanel.tsx, AgentCard.tsx, which only Sidebar renders). No Mobbin pass was run (kept short); pattern followed: flat dense lists with hover-revealed secondary controls.

- Agent cards: boxed cards became flat rows. Line 1 dot, name, status label (needs-you now just amber text, no ring/pill). Line 2 mono activity (omitted when empty). Line 3 muted `branch · N tok` with no icon.
- `last-instruction` is still in the DOM (same testid) but only shown on card hover, compact `who, ago`.
- Main session is one line: label plus the muted subtitle on the right.
- Mission row token count and the space-header autopilot switch show on hover only. Autopilot is still the same single `autopilot-switch` element.
- Queue header: title, pending count, a dot for running/paused (no "running"/"paused"/autopilot-switch crammed in), then Pause/Resume. The queue item's mission-name line is dropped when it only repeats the title.
- Tree guide lines lightened (`border-border/50`); spacing tightened.
- All data-testids, status markers and handlers are unchanged. `pnpm typecheck` passes; not visually checked.
