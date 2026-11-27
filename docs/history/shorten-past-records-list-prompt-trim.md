# shorten-past-records-list / prompt-trim

- `coordinatorPrompt` (src/main/claude-launch.ts): past-records list now prints the records folder once, then bare quoted file names ("join folder + name to Read"). Falls back to full paths if the paths don't share a folder (they always do: `pastRecords` lists one dir).
- Lead first prompt (src/main/missions.ts): it is just the coordinator-written `task` (merge agents: a one-line conflict description). It has no builder text duplicating `workerPrompt`, so nothing was removed there.
