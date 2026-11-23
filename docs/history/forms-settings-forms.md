# Settings forms polish (mission improve-the-form-ui-and-make-them-ea, lead settings-forms)

Mobbin refs: Mintlify (section heading + one-line description + field), Calendly (destructive action visually apart), incident.io (label, "(optional)" marker, helper under field).

- `ui/field.tsx` (new, shared): `FormSection` (title + description + rule) and `Field` (label, optional marker, hint; error replaces hint, `role="alert"`, id `${id}-error`).
- `ui/input.tsx`: `aria-invalid="true"` now draws a red border; disabled dims. Backwards compatible.
- `SpaceSettingsModal`: uses the shared primitives; each section has a description; plain-language hints; optional fields marked; the four number fields sit in a 2-column grid; button reads "Save changes". All data-testids kept.
- `ClaudeAccountsSection`: add-account form now has a visible label, helper text, duplicate-name error, trimmed names, and a disabled submit while empty.
- `AutopilotToggle`: boxed group, real label/for links, plain-language limits help, note that it applies immediately.
