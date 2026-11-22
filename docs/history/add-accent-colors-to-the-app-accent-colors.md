# Accent colours (mission add-accent-colors-to-the-app, lead accent-colors)

- `src/renderer/src/lib/accent.ts`: accent ids/swatches, `orc-accent` in localStorage, `data-accent` on `<html>` (absent for the default indigo). `initTheme()` calls `initAccent()`; `index.html` pre-paint script sets the attribute before first paint.
- `app.css`: per-accent overrides of `--color-primary`, `--color-ring`, `--color-primary-foreground`, one dark rule and one higher-specificity light rule (`:root[data-theme="light"][data-accent=…]`) each. Light values are darker for contrast; green/amber/teal use dark foreground text in dark theme.
- `components/AccentPicker.tsx` (`data-testid="accent-picker"`, per-swatch `accent-<id>`, aria-label + aria-pressed), mounted in `App.tsx` right after `ThemeToggle`.
- Not changed: `TerminalView.tsx` selection colour stays indigo (`#6a6df055`); status colours untouched (MissionTree bars are all status colours). Amber accent resembles the "needs-you" colour.
- Mobbin research skipped (swatch-dot row is the common pattern; kept tiny).
