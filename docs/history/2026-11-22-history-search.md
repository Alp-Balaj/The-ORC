# History search (workflow-improvement)

_Moved from docs/HANDOFF.md on 2026-11-22._

## History search: `search_history` (branch `workflow-improvement/history-search`, 2026-11-22)

- **The tool:** `mcp__orc__search_history({ query, limit? })` on the control server
  (`src/main/control-server.ts`). Returns short BM25-ranked snippets (file, heading, mission, date)
  so agents check past work for a few hundred tokens instead of reading whole records.
- **Sources:** the caller's space's mission records (`spaces.recordsPath(repoPath)`, chunked per `##`
  section) and the mission repo's `docs/**/*.md` (per heading; the repo root, not the worktree).
  Code is not indexed. Indexing lives in `src/main/history-index.ts`.
- **Index:** one SQLite FTS5 db at `<userData>/history-index.sqlite` (smoke runs: the out dir), via
  `node:sqlite`, no new dependency. Created lazily on the first search (`src/main/index.ts`).
- **Freshness:** each search reindexes files whose mtime changed, so there is no watcher.
- **Allow list and prompts:** loop-and-models added `mcp__orc__search_history` to the allow list and
  told coordinators and leads to use it (`claude-launch.ts`, see the section above).
