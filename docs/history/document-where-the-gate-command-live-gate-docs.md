# document-where-the-gate-command-live: gate-docs

Docs only. Verified DECISIONS-PENDING §6 ("gate command is a per-space setting in spaces.json,
nothing written into the repo") against src/main: accurate. Details (field `gateCommand`, saved in
`<userData>/spaces.json` by `Spaces.save`, read via `Spaces.gateCommand`, run by `Missions.runGate`
/ `mission-git.runGate` in the integration and `_merge-<worker>` worktrees, edited in the Merge
screen and space settings modal) are in `docs/adr/0002-gate-command-per-space-setting.md`.
Additions to §6 from the code: new spaces are seeded with a suggested typecheck gate.
PLAN.md §7 links the ADR; DECISIONS-PENDING §6 annotated as resolved.
