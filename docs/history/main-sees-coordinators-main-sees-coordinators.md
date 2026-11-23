# main-sees-coordinators

- Main session could already SendMessage/ListAgents (allow-list) and call `list_missions`; the real gaps were (1) coordinators were buried per mission in `list_missions`, (2) no graph at all on main (the Mission tree aside was hidden when main is selected).
- `src/main/index.ts` `missionsText`: new leading "Coordinators you can SendMessage" section (session name, mission, state, live status, session id) for every mission in every space.
- `mainSessionPrompt` (claude-launch.ts): re-call list_missions, lists go stale as missions start/stop.
- `App.tsx`: when main is selected the right aside shows "All coordinators": a synthetic `main` root node + each mission's coordinator (name = sessionName, parent `main`). Built from the live `missions` state, so it updates as missions start/stop. Clicking a coordinator opens that mission/terminal; the main node is a no-op.
- Not verified at runtime (no billed tests, no UI replay). Pre-existing typecheck errors in mission-git.ts and AccountsScreen.tsx are unrelated.
