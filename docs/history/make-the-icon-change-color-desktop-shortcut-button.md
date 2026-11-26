# Add-to-desktop button (make-the-icon-change-color / desktop-shortcut-button)

Header settings popover, "App" section, has an "Add to desktop" button (`data-testid="desktop-shortcut"`)
under "Update app". It follows the existing update button's style; no Mobbin research (a one-button addition to an existing menu).

- `src/main/desktop-shortcut.ts`: `createDesktopShortcut()` + `registerDesktopShortcutIpc` (channel `desktop-shortcut:create`),
  registered in `src/main/index.ts`, exposed as `window.orc.createDesktopShortcut` in preload.
- Returns `{status: 'created' | 'exists' | 'unsupported', path?, message}`. Never overwrites an existing shortcut.
- Windows: `The ORC.lnk` via `shell.writeShortcutLink`, target `wscript.exe scripts\orc-launch.vbs`, icon `build/icon.ico`
  (same as `scripts/install-shortcut.ps1`). Linux: `the-orc.desktop` as in `scripts/install-shortcut.sh`, chmod 755, `gio` trusted (best effort).
  macOS: `unsupported` message.
- Repo root is `app.getAppPath()`, so the shortcut points at whichever copy is running (the stable copy when launched from it).
- Errors are caught in the button and shown as a small line under it. Verified by typecheck only; no shortcut was created.
