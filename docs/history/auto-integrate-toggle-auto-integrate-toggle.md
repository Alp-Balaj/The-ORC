# Auto-integrate toggle

Per-space setting `autoIntegrate` (default true; older saved spaces load as true), stored in the
spaces JSON like `notifications`. `Spaces.autoIntegrate(root)`; `Missions.autoIntegrateFor(repo)`
is wired in `src/main/index.ts`. The Verifier-completion path in `missions.ts` only calls
`integrate()` for queue missions when it is on. Manual integration (Integrate button, coordinator
`integrate_mission`) is unaffected. UI: checkbox "Auto-integrate verified queue missions" in Space
settings, under "Agents & queue" (`data-testid="auto-integrate"`).
