# Disconnect a repo (mission add-a-way-to-disconnect-a-repo, lead disconnect-repo)

## What was built
- **Main:** the existing `spaces:remove` IPC (`src/main/index.ts`) now does a full disconnect. It throws if any mission in that repo is `running` (message names the missions). Otherwise it pauses the repo's queue, stops and drops its main session, stops the app run for and forgets its stopped missions (`removeMission`), removes the space from `spaces.json`, and sends `spaces:changed`. It never touches the repo's files, git branches or worktrees. Unmerged work of forgotten missions stays on its git branches. Reconnecting later via Add repo works as before (settings are kept by `Spaces`).
- **Renderer:** `SpaceSettingsModal` (the gear next to a space) has a "Disconnect repo" ghost-destructive button in the footer. It opens an inline confirm (title "Disconnect <name>?", text saying files, branches and worktrees are untouched, "Keep repo" / red "Disconnect repo"). A refusal or failure shows inline in the confirm ("Couldn't disconnect: ...").
- **Selection fallback:** `App.tsx` effect clears `dashRoot` / `mainRoot` when their repo is gone from `roots`, so the view falls back to the next repo or the empty state. A selected mission of the repo is gone with its removal.
- `window.orc.removeSpace` already existed in preload; no preload or type changes.

## Mobbin reference
Contra, Productboard, Replit and Mintlify all use: question title, one sentence on exactly what is and isn't affected, Cancel + red verb button. We follow that, inside the existing modal.

## Facts
- `roots` in App is spaces plus mission repoPaths, so stopped missions must be forgotten or the repo would stay visible in the sidebar.
- Not tested visually (no tests per brief); `pnpm typecheck` passes.
