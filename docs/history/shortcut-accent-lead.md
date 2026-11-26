# shortcut-accent

"Add to desktop" (Windows) now writes the .lnk with an accent-colored icon.
- `icon-color.ts`: `currentAccentHex()` (the hex the renderer last sent via the accent-icon IPC) and `accentIcoBuffer(hex)` (single 256px PNG-in-ICO).
- `desktop-shortcut.ts`: icon written to `<userData>/shortcut-icons/icon-<hex>.ico` (unique name per accent: Windows caches icons by path). Accent = optional IPC arg, else main's current accent, else falls back to build/icon.ico.
- If the shortcut already exists, clicking the button again rewrites it with the current accent (status stays `exists`, message says icon updated). No auto-refresh on accent change.
- Linux still uses build/icon.png (unchanged).
