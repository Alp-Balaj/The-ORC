# Header settings menu (de-emphasise-header-config-move-mode)

- New `components/HeaderSettingsMenu.tsx`: one muted sliders-icon button (`header-settings`) opening a popover (`header-settings-menu`). Sections: Mission (permissions, model, gating, tokens; keep testids `header-models`, `gating`), Plan usage, Appearance (ThemeToggle, AccentPicker), Keyboard shortcuts (keeps testid `open-shortcuts`). Closes on outside mousedown and Escape (capture + preventDefault so App's Escape handler doesn't also fire; focus returns to the button).
- Header now shows: mission name, needs-you chip, new `progress-summary` ("3 working · 1 done", muted), lifecycle/primary buttons as before (App/Run app, Pause/Stop, Merge to main), then the gear.
- `PlanUsageHeader` got `warnOnly`: in the header it renders only when a window is warn/hot; full meters live in the popover.
- No Mobbin lookup was done (brief check skipped); the pattern is the common gear → grouped-popover overflow.
