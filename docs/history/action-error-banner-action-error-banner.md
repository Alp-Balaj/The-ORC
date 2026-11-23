# Action-error banner (Rec #10)

- The `actionError` toast (12px, bottom-centre) is gone. It is now a dismissible `Banner` at the top of `<main>` (under the header).
- New `src/renderer/src/components/Banner.tsx`: one-line destructive banner (`border-destructive/40 bg-destructive/5`, AlertTriangle, truncated text),
  optional `action` button and `onDismiss` X. Same markup/classes as the failure banner from 'crash-vs-clean-exit-plus-a-failure-b'.
- That failure banner (inline JSX in App.tsx, `data-testid="failure-banner"`) lives on `integration/crash-vs-clean-exit-plus-a-failure-b`, not in this
  branch's base, so it was NOT refactored here. After merging both, replace its inline div with `<Banner ... action={...} data-kind=...>` and keep
  the action-error banner rendered after it (so it stacks below).
- The merge-notice / resumed / app-restore toasts no longer shift up for actionError.
