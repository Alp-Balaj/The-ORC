# Dialog forms polish (mission: improve-the-form-ui-and-make-them-ea, lead: dialog-forms)

Mobbin refs (Braintrust/Subframe/Plane create-project dialogs): label above field, helper text below, optional extras de-emphasised, secondary left of primary.

- LoopSetupDialog: subtitle, real labels, inline range errors, autofocus, alert/status roles. No Cancel: changes apply immediately ("Changes save as you make them.").
- OnboardingDialog: title + helper line per step, empty-scan state, focus on open.
- QueuePanel add form: label, placeholder, helper, inline validation, Add button, autofocus.
- Sidebar new-mission form: labels, helper text (gating explained), Required hint, "Starting…" state.
- No ask-human input form exists in the renderer (question-banner is display-only).
All data-testids kept. `pnpm typecheck` passes.
