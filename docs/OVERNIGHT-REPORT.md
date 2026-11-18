# Overnight report — 2026-11-18/19

_Kept current through the night. Newest state at the top of each section._

## What was built, and how it was verified

- (in progress) M1 end-to-end smoke test: hidden Electron, real coordinator + workers on Haiku in `orc-sandbox`.

## Broken or unverified

- Nothing verified yet tonight.

## Decisions made, and why

- **`--model` on every session.** `StartMissionRequest.model` (optional) is passed to the coordinator
  and every worker, so a mission runs on one model. Needed so tests run on Haiku; also a sensible
  product knob.
- **Trust prompts are answered only by the test harness**, and only for terminals whose cwd is
  under `orc-sandbox`. The app itself does not pre-trust folders (that would mean writing
  `~/.claude.json`).

## Open questions for the owner

- (none yet)

## Billed sessions used

- 0 so far.

## How to see it working

- (filled in once M1 passes)
