# codegraph sync spawn: log the reason

`src/main/codegraph.ts` `copyAndSync`: the catch around the detached `codegraph sync` spawn was an
empty `// ignore`. It now calls `console.error('codegraph: could not start background sync in <worktree>:', message)`,
the same pattern other `src/main` files use (no shared logger exists). It still never throws, so worktree
creation is unchanged. The async `child.on('error')` handler (ENOENT, codegraph not installed) stays silent on purpose.
