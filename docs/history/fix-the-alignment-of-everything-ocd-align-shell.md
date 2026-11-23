# Alignment pass: app shell, header, banners, dialogs, palette

Class-name-only changes (no colour/copy/behaviour changes); typecheck clean, no visual replay run.

- ui: Badge and Kbd both h-4.5 (18px); NativeSelect px-2.5 matches Input; ButtonGroup shrink-0. Button/Input heights unchanged (h-8 / sm h-7 / xs h-6).
- App.tsx: stray ml-1 removed from Integrate and banner buttons (container gap-2 governs); text-[12px] -> text-xs; arbitrary px sizes -> scale tokens (w-69 left header block = 276px, aligns with sidebar).
- HeaderSettingsMenu: rows min-h-7.5 so theme-toggle row matches text rows.
- AutopilotToggle: number-field labels share a bottom-aligned 30px box.
- PlanUsageHeader: 5h/wk labels fixed w-5 so meter bars line up.
- ShortcutsDialog: rows min-h-7; footer icon centred via items-center.
- CommandPalette: fixed w-3.5 leading slot so titles start at same x across mission/agent/command rows.
- Left alone (already aligned): Banner, EmptyState, ErrorBoundary, ModelFields, ThemeToggle, AccentPicker, app.css.
