# diff-error: show diff load errors

`useDiff` (MissionScreens.tsx) now returns `{ diff, error }`. The error is cleared on each new load and set from the caught error's message on failure. `DiffArea` takes an `error` prop and renders a destructive-styled "Couldn't load the diff: <message>" box (`data-testid="diff-error"`). A successful empty diff still shows the `empty` placeholder.
