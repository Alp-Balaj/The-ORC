# Sender label for "last instruction"
`lastInstructionBy` (src/shared/types.ts) is now `string | null`: `'you'` for human typing, else the sending agent's name
(resolved via `agentNameFor` in the UserPromptSubmit hook, src/main/missions.ts), falling back to `'coordinator'`.
Old saved `'coordinator'` values render unchanged (AgentCard prints the string as-is).
