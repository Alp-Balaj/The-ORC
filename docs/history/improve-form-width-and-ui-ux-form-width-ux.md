# Form width (form-width-ux)
- Added `components/ui/dialog.tsx`: `dialogPanel(size, extra)` gives the shared dialog panel classes. sm 440, md 560, lg 680px; `max-h-[calc(100vh-2rem)]`, scrolls inside.
- SpaceSettings, Onboarding, Shortcuts use lg; Accounts, LoopSetup use md. Inputs/selects were already `w-full`; Esc/Enter handling already existed in these dialogs.
- No Mobbin pass or visual check done (small change).
