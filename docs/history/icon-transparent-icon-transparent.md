# icon-transparent (icon-transparent)

App icon is now transparent: only the green orc glyph remains.
- `build/icon.svg`: removed the dark rounded-square `<rect>`; glyph paths/transform untouched (glyph bounds ~62..449 x 73..438 of 512, about 12% padding).
- `build/make-icons.mjs`: no longer reads the rect (BG/RX removed); `sample()` returns glyph colour or `[0,0,0,0]`. RGBA PNG (colour type 6) and 32-bit ICO frames keep alpha with premultiplied supersampling.
- Regenerated `build/icon.png` and `build/icon.ico` with `node build/make-icons.mjs`.
- References checked: `src/main/index.ts` BrowserWindow icon (ico/png) and `scripts/install-shortcut.{ps1,sh}` just point at the files; nothing depends on the background. Note: a green glyph on a transparent taskbar/shortcut icon may be low-contrast on some dark/green backgrounds.
