# Accent-colored app icon (make-the-icon-change-color / accent-icon)

- Renderer `lib/accent.ts` `apply()` reads the live `--color-primary` and sends it via `window.orc.setIconAccent(hex)` (IPC `icon:set-accent`).
- `src/main/icon-color.ts` recolors `build/icon.png` (flat-colored glyph: replace RGB, keep alpha) into a nativeImage and calls `setIcon` on every window; new windows get the last accent in `createWindow`.
- `build/icon.svg` / `.ico` stay green (the packaged/static default). No renderer logo component exists.
- Known gap: switching light/dark theme alone doesn't re-send the (theme-dependent) primary; it updates on the next accent apply/launch.
