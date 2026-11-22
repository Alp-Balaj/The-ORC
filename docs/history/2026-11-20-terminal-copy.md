# Copy from a terminal

_Moved from docs/HANDOFF.md on 2026-11-22._

## Copy from a terminal (branch `terminal-copy`, 2026-11-20)

- Select with the mouse, then Ctrl+C (with nothing selected it still interrupts the session),
  Ctrl+Shift+C, or right-click. `TerminalView.tsx`; the clipboard write goes through preload
  (`copyText`).
- The replay selects all through `el.orcTerm` (a test handle on the terminal element), presses
  Ctrl+C on xterm's textarea, reads the clipboard in main, then puts the owner's clipboard back.
