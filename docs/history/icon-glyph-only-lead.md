# icon-glyph-only

Bug: the "Add to desktop" .lnk icon showed a solid accent-colored square behind the glyph.
- Static `build/icon.svg`/`icon.png`/`icon.ico` were already transparent outside the glyph (verified: PNG is RGBA, make-icons.mjs samples `[0,0,0,0]` outside).
- Cause: `accentIcon` in `src/main/icon-color.ts` wrote the accent RGB into EVERY pixel of the premultiplied BGRA bitmap, including alpha=0 pixels. Invalid premultiplied data (color > alpha) makes the transparent area render as a colored tile once resized/encoded to PNG/ICO.
- Fix: color is now `channel * alpha / 255` per pixel, so transparent stays (0,0,0,0).
- Stale files: shortcut icon file renamed `icon-v2-<hex>.ico` in `<userData>/shortcut-icons` so earlier buggy `icon-<hex>.ico` files (cached by Windows by path) are never reused. Clicking "Add to desktop" rewrites the .lnk.
- Not run/verified visually (no tests per brief).
