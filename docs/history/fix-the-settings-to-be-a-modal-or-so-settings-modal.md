# Space settings as a modal (settings-modal)

## What was built

- The inline `SpaceSettings` form in the sidebar (`Sidebar.tsx`) is gone. Its replacement is
  `src/renderer/src/components/SpaceSettingsModal.tsx`: a centered dialog, mirroring
  `LoopSetupDialog.tsx` (backdrop, `role="dialog"`, `aria-modal`, `aria-labelledby`).
- The dialog has a scrollable body with labelled sections (Commands, Agents & queue, Models,
  Storage, Notifications) and helper text under each field. The footer is sticky: "Re-run
  onboarding" as a secondary action on the left, Cancel and Save on the right.
- `HeaderSettingsMenu.tsx` has a "Space settings" entry (Settings2 icon, `data-testid="open-space-settings"`)
  next to Keyboard shortcuts and Accounts. It shows only when a mission is selected and opens the
  dialog for `mission.repoPath`.

## How it opens

- Gear button in the sidebar space row (`space-settings-button`): sets `settingsFor` in `Sidebar`.
- Mod shortcut `spaceSettings` (existing): same state.
- Window event `SPACE_SETTINGS_EVENT = 'orc:space-settings'` (detail: space root), sent by
  `openSpaceSettings(root)`. `Sidebar` listens for it, like `LOOP_SETUP_EVENT`.
- The modal renders only when the root matches a space in `spaces`.

## Behaviour

- Save calls `window.orc.updateSpace(space.root, patch)` with the same patch keys and mappings as the
  old form, then closes. Gate, run and records are `|| null`. Models go through `fromDraft`.
- Saving: all fields and the Cancel, Re-run and close buttons are disabled (a `fieldset disabled`
  wraps the body). Save reads "Saving…".
- Error: a rejected `updateSpace` shows `role="alert"` text in the footer, with the same regex cleanup
  as `NewMissionForm`. The modal stays open and the fields are editable again.
- Validation (inline text under the field, `aria-invalid` and `aria-describedby` set, Save disabled):
  - Most live agents: whole number 1 to 50.
  - Queue parallelism: whole number 1 to 10.
  - Usage threshold: whole number 1 to 100.
  - Idle stop: whole number 0 to 1440.
  - Empty numeric fields count as invalid. The old form silently kept the saved value for an empty
    field. This is a deliberate change.
- Escape closes (window capture listener, `stopPropagation`, so App's Escape handler does not also
  fire). It does nothing while saving. A click on the backdrop closes it when not saving.
- Focus: the run command field is autofocused. Tab and Shift+Tab are trapped inside the dialog. On
  close, focus returns to the element that had it before the dialog opened.

## Testids kept

`space-settings` (the form, inside the dialog), `run-command`, `gate-command`, `max-live`,
`records-dir`, `usage-threshold`, `max-parallel`, `idle-stop-minutes`, `notifications-enabled`,
`space-rerun-onboarding`, `space-settings-button`. New: `space-settings-dialog`,
`space-settings-error`, `space-settings-save`, `open-space-settings`.

## Not done

- No Mobbin research was done for this change (the brief marked it optional).
- No tests were written or run. `pnpm typecheck` passes.
