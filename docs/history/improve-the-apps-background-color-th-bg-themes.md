# Background palettes (mission improve-the-apps-background-color-th, lead bg-themes)

- Light/dark/system stays the mode toggle. A separate **Background** picker (Settings menu, between Theme and Accent) chooses a palette within the current mode.
  - Dark: graphite (default, the old tokens), midnight, warm charcoal, true black.
  - Light: white (default, the old tokens), paper, cool gray.
- `src/renderer/src/lib/background.ts`: palette list, per-mode localStorage keys `orc-bg-dark` / `orc-bg-light`, sets `data-bg` on `<html>` (absent = mode default). Re-applies on light/dark switch via `onThemeChange`. Called by `initBackground()` in `main.tsx` after `initTheme()`.
- `app.css`: `:root[data-theme=..][data-bg=..]` blocks override surface/border/neutral-text tokens only; accent and status colours untouched, so accents work on every palette.
- No flash: the inline script in `index.html` sets `data-bg` and the pre-paint colour from the same keys. **Its CSP sha256 hash in the meta tag must be recomputed whenever that script changes.**
- Terminal: `TerminalView.tsx` keeps the DARK/LIGHT ANSI palettes but takes its background from the live `--color-background` (dark) / `--color-panel` (light) token, and re-themes on `onBackgroundChange`.
- Not done: Electron `backgroundColor` in `src/main/index.ts` still uses graphite/white (only visible before the page paints). Persistence is localStorage like accent; no main-process setting.
- UI reference: Revolut's Appearance page (separate Mode and Background rows with a swatch row) on Mobbin.
