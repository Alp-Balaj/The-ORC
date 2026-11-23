# Project onboarding (enrollment) — create-an-enrollment-period-onto-a-n / project-onboarding

## What it does
Opening a repo The ORC has never enrolled runs a 4-step modal instead of dropping the user into an
empty state: Scan → Git readiness → Permissions → CLAUDE.md + confirm. Confirming enrolls the repo
and leads straight into the new-mission form (the first mission).

## How it works
- **Persistence:** `Settings.enrolledAt` (epoch ms | null) in `spaces.json` (`src/main/spaces.ts`).
  Spaces saved before this existed (plain paths, or objects without the key) count as enrolled.
  New spaces start `null`. In-memory spaces (`file === null`: tests, smoke) are enrolled on add so
  smoke runs skip onboarding. `Spaces.enroll/unenroll`; `SpaceView.enrolledAt`.
- **Scan:** `src/main/onboarding.ts` `scanRepo()` (never throws): git repo?, branch, default branch
  (origin/HEAD, else main/master), dirty files (`.orc/` ignored, cap 50), has commits, package
  manager, CLAUDE.md, `.claude/`, settings files, suggested gate, `DeniedGitWrites`, modes
  (main = bypassPermissions, mission default = acceptEdits). `createStarterClaudeMd()` writes with
  flag `wx`: never overwrites.
- **IPC:** `onboarding:scan | create-claude-md | enroll | reset` (roots must be existing spaces);
  preload `scanRepo, createClaudeMd, enrollSpace, resetEnrollment`.
- **UI:** `OnboardingDialog.tsx`, hooked in `Sidebar.tsx`: `openRepo()` opens it when
  `enrolledAt === null`; a "Set up" button on un-enrolled rows; "Re-run onboarding" in space
  settings (opens with `rerun`, doesn't unenroll). States: scanning spinner, scan error + Retry,
  blocking not-a-repo / no-commits (Re-scan), dirty-tree warning, saving, save error.
- **Mobbin refs:** Vercel "Connecting to a git repository"
  (https://mobbin.com/flows/17f6c370-4589-456b-bda1-dc4acd1233ac), Emergent "Connecting to GitHub"
  (https://mobbin.com/flows/3b47800b-c8a6-4a63-976e-1baa237961da): short modal, one primary action.

## Not verified
Typecheck only. No hidden replay was run and no tests were added. Adding a repo through
`missions:start` / `queue:add` leaves it un-enrolled (shows the "Set up" button), no auto-dialog.
