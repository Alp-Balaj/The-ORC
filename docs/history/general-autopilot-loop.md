# Autopilot loop (general / autopilot-loop, 2026-11-23)

- **What:** per-space autopilot (`src/main/autopilot.ts`, class `Autopilots`). When on and the space's queue has
  no open item (all done, or none), it runs one read-only discovery session, parses up to N tasks, and calls
  `queue.addMany`, then `queue.start` if the queue wasn't running. Then it waits for the queue to empty again: loop.
- **Discovery session:** `claude -p --tools Read,Grep,Glob --model haiku --effort low`, no MCP, no session
  persistence, 5 min timeout, same permission mode as the space's queue (`bypassPermissions` mapped to `dontAsk`
  since the tools are read-only anyway). It cannot run commands, so type errors are only found by reading code.
- **Dedupe:** the prompt lists every queue item title (past and current) plus titles autopilot added before
  (kept in `autopilot.json`, last 300); results are filtered again by normalized title.
- **Safeguards:** default OFF; `maxTasks` per round (1-10, default 5); `maxEmptyRounds` (1-10, default 2) stops it
  (state `stopped`; toggle off/on resets); a failed/unparseable round counts as an empty one; pauses (state
  `usage`) when the 5h or weekly window is over the space's `usageThreshold` (`overThreshold`), re-checked on
  usage updates and every 5 min; a queue with open tasks (including one paused by a red flag) is left alone.
- **Wiring:** `index.ts` (queue emit and usage call `onQueues`/`onUsage`; IPC `autopilot:list`/`autopilot:set`,
  push `autopilot:changed`), preload `listAutopilot/onAutopilot/autopilotSet`, `AutopilotView`/`AutopilotPatch`
  in `shared/types.ts`, UI `AutopilotToggle.tsx` mounted in `SpaceSettings` (Sidebar.tsx). State saved to
  `<userData>/autopilot.json` (smoke: memory only). queue.ts and QueuePanel.tsx untouched.
- **Not verified:** no billed run; `--effort low` flag exists in `claude --help` but the discovery reply format
  was not exercised against real Haiku. The status line shows only in the space settings form.
