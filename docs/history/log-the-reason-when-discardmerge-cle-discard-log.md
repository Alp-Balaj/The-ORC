# discard-log: log why discardMerge failed

`src/main/missions.ts`: three `this.git.discardMerge(...).catch(() => {})` calls (ORC-branch merge-agent start failure, `orcMergerFailed`, worker merge-agent start failure) now use `.catch((e) => this.orcNote(mission, ...))`. The note reads "could not discard the merge worktree for <key/agent> (mission <name>): <error message>". `orcNote` only emits a feed note, so it can't throw; the flow continues as before.
