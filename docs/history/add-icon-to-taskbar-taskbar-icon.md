# add-icon-to-taskbar / taskbar-icon

- Root cause: no `app.setAppUserModelId`, so Windows tied the taskbar button to Electron's default identity (Electron icon in dev).
- `src/main/index.ts`: `app.setAppUserModelId('com.theorc.app')` on win32, before the single-instance lock.
- `src/main/icon-color.ts`: `accentIcon()` now returns a 256px image on win32 so `win.setIcon` (used by `applyAccentIcon` and on window creation) scales cleanly for the taskbar.
- Icon path `../../build/icon.ico` resolves in dev (`out/main` -> repo root). There is no electron-builder config in the repo, so no packaging change; a packager would need `build/` shipped as extraResources.
