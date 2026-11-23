# Needs-you chip becomes a jump (rec #1 of first-notice-research)

- `App.tsx`: header chip is a `<button data-testid="needs-you-chip">` next to the mission name. Counts needs-you agents across all missions, current mission first. Label: `2 need you · 1 in other mission(s)`, or `1 in other mission` when this mission has none. Click jumps via `selectAgent` (switches mission); a `merge === 'review'` agent opens `setView({ review: name })`.
- New shortcut `jumpNeedsYou` = Mod+Shift+J (Agents group; shows in ShortcutsDialog/palette automatically from `SHORTCUTS`).
- Ring: `.animate-orc-ring` (app.css, one-shot, only under `prefers-reduced-motion: no-preference`) is applied when the total rises (not on mount/decrease); the button is re-keyed to replay it. The existing `animate-orc-pulse` is an infinite opacity pulse, so it wasn't reused.
- Focus-visible ring + aria-label on the button.
