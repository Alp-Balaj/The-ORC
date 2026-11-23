# Alignment pass: Sidebar and QueuePanel

Files: `src/renderer/src/components/Sidebar.tsx`, `src/renderer/src/components/QueuePanel.tsx`. Copy and colours unchanged.

## Changes

- **Sidebar.tsx, gate-command row (SpaceSettings):** `flex gap-1.5` -> `flex items-center gap-1.5`. The `Use <gate>` button is `h-7` beside an `h-8` input; it sat 4px high. Now centred.
- **Sidebar.tsx, mission marker column:** the attention pill / ready check / working dot were in a variable-width slot, so they drifted across rows. Wrapped in `flex min-w-3.5 shrink-0 items-center justify-center`, so the 14px icon and dot share one column. Pills may still widen the slot.
- **Sidebar.tsx, mission question line:** `pr-2` -> `pr-1.5`, to match the mission row's `px-1.5` inner edge.
- **QueuePanel.tsx, StatusIcon:** accepts an optional `className`. Same classes as before, merged with `cn`.
- **QueuePanel.tsx, queued-item drag grip:** was in flow with `-ml-1`, which pushed the status icon 14px right on queued rows only. Now `absolute left-1.5 top-1/2 -translate-y-1/2` inside the `relative` row. On hover the status icon fades out (`group-hover/item:opacity-0`) and the grip shows in the same spot. Every row's status icon now sits in one column.
- **QueuePanel.tsx, queue item detail lines:** `pl-[18px]` -> `pl-4.5` (same 18px, on the scale).
- **QueuePanel.tsx, running / paused labels:** dropped the extra `ml-1`, so the gap before them matches the `gap-1.5` used everywhere else.
- **QueuePanel.tsx, clear-done / clear-all row:** `px-1` -> `px-1.5`, to match the row edge.
- **QueuePanel.tsx, add-task form:** `px-0.5` -> `px-1.5`. The input now lines up with the status-icon column (23px from the list edge).
- **QueuePanel.tsx, permission-mode select:** `h-6` -> `h-7`, to match the `h-7` input and add button above it.

## Conventions settled on

- **Row height:** `h-7` for every sidebar row (space, mission, queue header) and `h-7` for form controls. Small action buttons inside a row stay `h-5` (xs). Icon buttons are `size-6` in space rows and `size-7` in the queue form.
- **Horizontal rhythm:** list `px-2`, space row `px-1`, mission and queue rows `px-1.5`. Nested blocks use one step: `ml-2.5 border-l pl-1.5`, so a child's chevron starts at 23px.
- **Icons:** space chevron and folder `size-3.5`; mission, queue and item chevrons, status icons and grips `size-3`; markers `size-1.5` dots and `size-3.5` checks. Icon-to-text gap is `gap-1.5` everywhere.
- **Spacing tokens:** only Tailwind scale values (0.5, 1, 1.5, 2, 2.5, 3, 4, plus 4.5 for the 18px indent). Left in place: the 10.5px vs 11px meta-text sizes, which are a typography choice, not alignment.
