# Window title count (title-count)

The window title shows `(N) The ORC` when N agents are in needs-you state across all missions, plain `The ORC` at 0.

- `src/renderer/src/App.tsx`: an effect sets `document.title` from `needsTotal` (the length of `needsList`, the same list behind the header "N need you" chip).
- No main-process change: `index.html` and `BrowserWindow` both say `The ORC`, and there is no `page-title-updated` handler, so Electron lets the page title through.
- OS notifications/badge already existed (`src/main/notifications.ts`); no second path was added.
