# Crash vs clean exit + failure banner (Rec #6)

- `AgentView.exitKind` ('clean' | 'crashed' | null) and `exitCode`, set in `Missions.terminalExited`. Crashed = non-zero pty exit
  while the mission runs, the agent wasn't already ended (Stop, stop_agent, mission stop) and hadn't reported done. Only the exit
  code is known (TerminalHost passes no signal). Reset in `relaunch`.
- `shownAgents` keeps crashed agents (unless dismissed). Cards/tree: destructive bar, dot and label "crashed", not dimmed.
- `missionFailure(m)` in `shared/types.ts`: crash > conflict > gate failed (not shown after merge to main). Banner in App.tsx
  `<main>` top (inside the terminal column, since the grid has two rows), `border-destructive/40 bg-destructive/5`, one line, one
  button: crash/conflict select the agent's terminal (conflict in review opens the review); gate opens the Merge screen.
- Sidebar: red dot (`mission-error-dot`) for crash or conflict, beats the needs badge and working dot.
- No per-agent restart exists, so crash recovery is "Open its terminal" (shows why it died); X on the card dismisses it.
