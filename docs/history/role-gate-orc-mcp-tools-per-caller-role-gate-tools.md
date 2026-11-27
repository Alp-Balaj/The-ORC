# Role-gated orc MCP tools

`buildMcp` (src/main/control-server.ts) registers only the tools a caller's role may use. The role comes from the new `ServerHandlers.roleOf(caller)`, wired in src/main/index.ts: main session (`mainByTerminal`) -> `main`, else `missions.callerInfo(c)?.role` (`coordinator` | `worker`), else `null`.

| Role | Tools |
|---|---|
| coordinator | spawn_agent, report_done, ask_human, stop_agent, propose_split, integrate_mission, search_history, add_to_queue |
| worker (lead) | report_done, ask_human, search_history (3 of 10) |
| main | ask_human, search_history, list_missions, start_mission |
| unresolvable (null) | all 10 (safe fallback: the runtime checks in the handlers still refuse) |

Runtime permission checks are unchanged and remain the backstop. Implementation shadows `server.registerTool` with a filter, so tool definitions are untouched.
Note: tool lists are built per HTTP request, so the role is resolved fresh each time. Not tested (typecheck only).
