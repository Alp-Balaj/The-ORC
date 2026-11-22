import { spawn } from 'node:child_process'
import { cp, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'

/** CodeGraph (`codegraph`) keeps its index in `.codegraph/` at a project root, with file paths
 *  stored relative to that root, so a copy works in a worktree as is. Without one, codegraph in
 *  a worktree under <repo>/.orc/ walks up and silently answers from the main checkout's index.
 *  The copy skips the live daemon's pid/socket/lock files and SQLite's -shm (rebuilt on open);
 *  the db and its -wal go together. A background `codegraph sync` (incremental, content-hash
 *  based) then catches the index up to the worktree's branch, when codegraph is installed. */

const RUNTIME_FILE = /(\.pid|\.sock|\.lock|-shm)$/

async function isDir(path: string): Promise<boolean> {
  return stat(path).then((s) => s.isDirectory(), () => false)
}

async function copyAndSync(repo: string, worktree: string): Promise<void> {
  const source = join(repo, '.codegraph')
  const target = join(worktree, '.codegraph')
  if (!(await isDir(source)) || (await stat(target).then(() => true, () => false))) return
  await cp(source, target, { recursive: true, filter: (src) => !RUNTIME_FILE.test(basename(src)) })
  try {
    const child = spawn('codegraph', ['sync', worktree], { cwd: worktree, stdio: 'ignore', detached: true, timeout: 120_000 })
    child.on('error', () => {}) // ENOENT: codegraph isn't installed
    child.unref()
  } catch {
    // ignore
  }
}

/** Gives a new worktree its own copy of the repo's CodeGraph index. Never throws and never
 *  holds the caller more than ~2 s; a slower copy carries on in the background. */
export async function shareCodegraph(repo: string, worktree: string): Promise<void> {
  const work = copyAndSync(repo, worktree).catch(() => {})
  await Promise.race([work, new Promise<void>((r) => setTimeout(r, 2000).unref())])
}
