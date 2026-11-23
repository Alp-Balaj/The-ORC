# Accent lines (mission general, lead accent-lines)

Brief: Linear/Raycast/Vercel (Mobbin Linear screens) use the accent sparingly: a quiet selected-row fill, hairlines, short indicator segments; never big fills. Here: thin lines only, all from `--color-primary` (so they follow the chosen accent and theme).

Built (`app.css`, bottom): `.accent-hairline` (fading 1px gradient on a bar's bottom edge), `.panel-title` (20px accent segment on a panel title's top edge), `.accent-rule` (divider with a short accent start).
Applied: MissionTree selected node gets `border-primary/60` + 1px primary ring; EmptyState current step gets an inset 2px primary left edge and an `accent-rule` above the checklist.
Not applied (files owned by other leads): add `accent-hairline` to the `<header>` in App.tsx, `panel-title` to the "Mission tree" and "Feed" title bars (App.tsx) and "Spaces" (Sidebar.tsx). Banner left alone (error banner stays destructive-coloured).
