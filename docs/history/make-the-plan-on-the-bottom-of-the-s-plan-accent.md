# Plan meter uses the accent color (plan-accent)

The "Plan 5h x% · wk y%" element at the bottom of the sidebar is `PlanUsageMeter` in
`src/renderer/src/components/QueuePanel.tsx` (rendered by `Sidebar.tsx`).

- The app's accent is `--color-primary` (Tailwind `text-primary` / `bg-primary`), which follows the
  user's chosen accent and theme. No new color was added.
- The "Plan" label is now `text-primary font-medium`; the usage bar fill is `bg-primary`.
- At or over the threshold (`hot`) it still switches to the existing `needs` warning color, so the
  warning state is unchanged.
- The element has no hover/active/disabled states (non-interactive), so nothing else changed.
