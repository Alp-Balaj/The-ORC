import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const run = promisify(execFile)

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd })
  return stdout.trim()
}

export async function repoRoot(path: string): Promise<string> {
  // git prints C:/x/y on Windows; resolve() turns it into C:\x\y, the form dialogs and join()
  // produce, so roots compare equal wherever they came from. A no-op on POSIX.
  return resolve(await git(path, 'rev-parse', '--show-toplevel'))
}

export async function currentBranch(repo: string): Promise<string> {
  return git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')
}

/** Worktrees live under <repo>/.orc/ so they sit inside a folder Claude Code
 *  already trusts. Excluded through .git/info/exclude, never the repo's own
 *  .gitignore, so The ORC leaves no trace in tracked files. */
export async function ensureOrcExcluded(repo: string): Promise<void> {
  const commonDir = await git(repo, 'rev-parse', '--git-common-dir')
  const exclude = resolve(repo, commonDir, 'info', 'exclude')
  await mkdir(resolve(repo, commonDir, 'info'), { recursive: true })
  const existing = await readFile(exclude, 'utf8').catch(() => '')
  if (!existing.split('\n').includes('/.orc/')) {
    await appendFile(exclude, `${existing.endsWith('\n') || existing === '' ? '' : '\n'}/.orc/\n`)
  }
}

export interface Worktree {
  path: string
  branch: string
}

export async function addWorktree(
  repo: string,
  mission: string,
  agent: string,
  base: string
): Promise<Worktree> {
  await ensureOrcExcluded(repo)
  const path = join(repo, '.orc', 'worktrees', mission, agent)
  const branch = `orc/${mission}/${agent}`
  await git(repo, 'worktree', 'add', '-b', branch, path, base)
  return { path, branch }
}

/** Branches under refs/heads/<prefix>, e.g. "orc/ui-revamp/". */
export async function branchesUnder(repo: string, prefix: string): Promise<string[]> {
  const out = await git(repo, 'for-each-ref', '--format=%(refname:short)', `refs/heads/${prefix}`)
  return out ? out.split('\n') : []
}
