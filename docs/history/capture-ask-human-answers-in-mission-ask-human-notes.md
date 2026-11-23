# ask_human answers in mission notes (ask-human-notes)

Finding: this is already implemented in `src/main/missions.ts`; only the docs were stale
(`docs/HANDOFF.md` open item and `docs/PLAN.md` "Mission records" "Not yet" bullet).

How it works:
- `askHuman()` stores the question in `agent.pendingQuestion` (persisted with the mission state,
  see the save/restore code around `pendingQuestion`), so it survives a restart.
- In `hookEvent` `UserPromptSubmit`, when the prompt is from the human (not cross-session, launch,
  [The ORC] or system) and the agent has a `pendingQuestion`, `record()` appends
  `Question from <agent>` with `Q:` / `A:` to the mission record note (`records.ts` `appendRecord`),
  then clears `pendingQuestion`.
- Capture point is the human's next prompt typed into that session's terminal: there is no
  separate UI answer path.

Follow-up for the docs pass: remove the HANDOFF open item and the PLAN "Not yet" bullet.
