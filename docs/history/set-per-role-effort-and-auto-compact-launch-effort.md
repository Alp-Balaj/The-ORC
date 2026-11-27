# set-per-role-effort-and-auto-compact / launch-effort

All in `src/main/claude-launch.ts` (`claudeArgs`); no caller changes.
- `--effort` per role via `defaultEffort(sessionName)`: `<mission>/coordinator` medium, everything else (leads, mergers, main session) low; `LaunchSpec.effort` overrides. Autopilot/verifier keep their own flags.
- `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=75` set in the settings `env` key (merged with `CLAUDE_CODE_SUBAGENT_MODEL`), so only interactive sessions get it and the value is constant (cache-stable).
- `--disable-slash-commands` for non-coordinators (coordinator keeps skills, e.g. grill-me). Not applied: ENABLE_TOOL_SEARCH (default already defers MCP tools); orc MCP server untouched.
- Flags verified in `claude --help` (`--effort <level>`, `--disable-slash-commands`).
