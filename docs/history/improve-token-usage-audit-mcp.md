# improve-token-usage / audit-mcp: ORC MCP server token audit

Scope: `src/main/control-server.ts` (tool names, descriptions, schemas, response payloads).

## Findings
- Tool definitions (9 tools: spawn_agent, report_done, ask_human, stop_agent, propose_split,
  integrate_mission, search_history, add_to_queue, list_missions, start_mission) are listed in every
  ORC session's context on every turn. Descriptions were verbose (examples, restated behaviour).
- **Applied:** trimmed all descriptions and `.describe()` strings, keeping names, schemas, validation
  and behaviour. The tool-definition source shrank 6521 -> 5396 bytes (-1.1 KB, about -280 tokens per
  session per context load; the prompt-cached prefix makes the recurring cost small but it is paid by
  every lead and subagent-spawning session).
- Response payloads were already terse (one-line strings); nothing changed.
- `search_history`: default snippet count/size lives in index.ts / history-index.ts (other audits' files). Not touched.

## Not done (needs files outside this audit)
- **Role-gating:** every session sees all 10 tools although several are "Coordinator only" / "Main
  session only". `buildMcp` could register only the tools for the caller's role (needs a role lookup on
  `ServerHandlers`, i.e. index.ts). Likely saves another ~50% of the tool-definition tokens for leads.
- The `[The ORC] ...` notice text is built in the mission layer, not here.
