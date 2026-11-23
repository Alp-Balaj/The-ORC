# Update app button (update-button)

- Header settings popover has an "App" section with an **Update app** button (`HeaderSettingsMenu.tsx`).
- IPC `app-update:run` (`src/main/app-update.ts`, preload `updateApp`) runs `scripts/orc-app.sh rebuild`.
- The existing `update` mode ends with `exec electron .`, which would launch a second app. So a new `rebuild` mode
  was added: checkout main in the stable copy, `pnpm install --frozen-lockfile && pnpm build`, then exit. The running
  app is never quit or killed; it keeps old code until the user restarts it. UI wording says so.
- Errors reject the invoke and surface through App's unhandledrejection -> action-error banner. One run at a time.
- The script resolves via `app.getAppPath()/scripts`; `rebuild` exits inside one block so a self-replacing checkout is safe.
- Mobbin research skipped (a single button row in an existing popover).
