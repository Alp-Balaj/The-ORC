# Integrate shortcut

Added `integrate` shortcut (Mod+Shift+G, global, group Missions) in `src/renderer/src/lib/shortcuts.ts`. Mod+Shift+I avoided: it is the Chromium devtools chord. App.tsx handles it like the Integrate button: `setView('merge')` for the selected mission, only when the button would be enabled (`merged.length > 0 || mergedToMain`). The button tooltip uses `withHint(..., 'integrate')`. Palette and cheat sheet read SHORTCUTS, so no changes there.
