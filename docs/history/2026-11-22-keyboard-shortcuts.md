# Keyboard shortcuts

_Moved from docs/HANDOFF.md on 2026-11-22._

## Keyboard shortcuts (branch `ux-friendliness/shortcuts`, 2026-11-22)

- **Keys** (Mod = Cmd on macOS, Ctrl elsewhere; "app" = not while typing in a terminal or input):
  - Ctrl+Tab / Ctrl+Shift+Tab: next / previous mission. Mod+1–9: jump to mission (9 is the last).
  - Mod+Shift+N (or Mod+N, app): new mission. Mod+Shift+M: Merge to main. Mod+,: space settings.
  - Alt+↓ / Alt+↑: next / previous agent. Mod+0: coordinator. Mod+`: focus the terminal.
  - Mod+K or Mod+P (app), Mod+Shift+P: quick switcher. Mod+/ or ? (app), F1: shortcuts cheat sheet.
  - Mod+B (app), Mod+Shift+B: toggle sidebar. Mod+Shift+L: cycle theme. Escape: close dialog.
- **`lib/shortcuts.ts` is the single source of truth** (`SHORTCUTS`): the handlers, the cheat
  sheet, the palette and button tooltips (`withHint`) all read it.
- **Terminal rule:** "global" bindings fire everywhere, "app" bindings only outside terminals and
  inputs (on macOS, Mod bindings also fire in the terminal: Cmd never reaches the shell). A
  capture-phase window listener (`installGlobalShortcuts`) handles them; xterm's custom key
  handler drops matched keys so they never reach the session. Plain Ctrl+C/D/R/L/A/E/K…, arrows,
  Tab and Escape still go to the session; Ctrl+C copy is unchanged.
- **Ctrl+Tab stays Ctrl on macOS:** Cmd+Tab is the OS app switcher.
