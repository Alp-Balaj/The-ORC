import { execFile, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { shareCodegraph } from './codegraph.ts'
import { ensureOrcExcluded } from './git-worktrees.ts'

/** Git for missions. The app owns git: agents never commit. Every call in one repository is
 *  serialized (two workers finishing at once would otherwise race on index locks), times
 *  out, and never prompts. */

export class GitError extends Error {
  readonly stderr: string
  readonly code: number | null
  constructor(message: string, stderr: string, code: number | null) {
    super(message)
    this.stderr = stderr
    this.code = code
  }
}

const queues = new Map<string, Promise<unknown>>()

/** Runs `fn` after every earlier call for the same repo has finished. */
export function serialized<T>(repo: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(repo) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  queues.set(repo, next.catch(() => {}))
  return next
}

export function git(cwd: string, args: string[], opts: { timeoutMs?: number; allowFail?: boolean } = {}): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: opts.timeoutMs ?? 60_000,
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_MERGE_AUTOEDIT: 'no' }
      },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : 1) : 0
        if (err && !opts.allowFail) reject(new GitError(`git ${args.join(' ')}: ${stderr.trim() || err.message}`, stderr, code))
        else resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code })
      }
    )
  })
}

/** Commits use the repo's own identity; if it has none, The ORC's. */
async function identityArgs(cwd: string): Promise<string[]> {
  const name = await git(cwd, ['config', 'user.name'], { allowFail: true })
  const email = await git(cwd, ['config', 'user.email'], { allowFail: true })
  return [
    ...(name.stdout ? [] : ['-c', 'user.name=The ORC']),
    ...(email.stdout ? [] : ['-c', 'user.email=orc@localhost'])
  ]
}

/** Commits everything in a worktree. Returns the new commit, or null when there was nothing
 *  to commit (a repeated or empty report_done is not an error). */
export async function commitAll(repo: string, worktree: string, message: string): Promise<string | null> {
  return serialized(repo, async () => {
    await git(worktree, ['add', '-A'])
    const staged = await git(worktree, ['diff', '--cached', '--quiet'], { allowFail: true })
    // A conflict resolved in favour of the worker's own version stages nothing, but the merge
    // still has to be concluded, or the retry loops forever.
    const merging = (await git(worktree, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { allowFail: true })).code === 0
    if (staged.code === 0 && !merging) return null
    await git(worktree, [...(await identityArgs(worktree)), 'commit', '-q', '--no-verify', '-m', message])
    return (await git(worktree, ['rev-parse', 'HEAD'])).stdout
  })
}

export const integrationBranch = (mission: string): string => `integration/${mission}`
/** Worker names are [a-z0-9-], so "_integration" can never collide with one. */
export const integrationPath = (repo: string, mission: string): string => join(repo, '.orc', 'worktrees', mission, '_integration')

/** The mission's integration worktree, created from `base` the first time. Merges happen
 *  there, never in the owner's checkout. */
export async function ensureIntegration(repo: string, mission: string, base: string): Promise<string> {
  return serialized(repo, async () => {
    const path = integrationPath(repo, mission)
    if (!existsSync(path)) {
      await ensureOrcExcluded(repo)
      const exists = await git(repo, ['rev-parse', '--verify', '-q', `refs/heads/${integrationBranch(mission)}`], { allowFail: true })
      if (exists.code === 0) await git(repo, ['worktree', 'add', '-q', path, integrationBranch(mission)])
      else await git(repo, ['worktree', 'add', '-q', '-b', integrationBranch(mission), path, base])
      await shareCodegraph(repo, path)
    }
    return path
  })
}

export type MergeResult =
  | { kind: 'merged'; commit: string }
  | { kind: 'up-to-date' }
  | { kind: 'conflict'; files: string[] }

/** Merges a worker branch into the integration worktree. A conflict is aborted cleanly and
 *  reported with the conflicting files. */
export async function mergeIntoIntegration(repo: string, mission: string, branch: string, message: string): Promise<MergeResult> {
  return serialized(repo, async () => {
    const wt = integrationPath(repo, mission)
    const already = await git(wt, ['merge-base', '--is-ancestor', branch, 'HEAD'], { allowFail: true })
    if (already.code === 0) return { kind: 'up-to-date' as const }
    const r = await git(wt, [...(await identityArgs(wt)), 'merge', '--no-ff', '--no-verify', '-m', message, branch], { allowFail: true })
    if (r.code === 0) return { kind: 'merged' as const, commit: (await git(wt, ['rev-parse', 'HEAD'])).stdout }
    const files = (await git(wt, ['diff', '--name-only', '--diff-filter=U'], { allowFail: true })).stdout.split('\n').filter(Boolean)
    await git(wt, ['merge', '--abort'], { allowFail: true })
    if (files.length === 0) throw new GitError(`merge of ${branch} failed: ${r.stderr}`, r.stderr, r.code)
    return { kind: 'conflict' as const, files }
  })
}

export interface GateResult {
  command: string
  ok: boolean
  exitCode: number | null
  output: string
  at: number
}

/** The bash that runs gate commands. On Windows a bare `bash` on PATH is usually WSL's
 *  (System32\bash.exe), so Git for Windows' bash is found next to git.exe instead. */
let gateBash: string | undefined
export function bashPath(): string {
  if (gateBash) return gateBash
  gateBash = 'bash'
  if (process.platform === 'win32') {
    const candidates: string[] = []
    try {
      // git.exe lives in <Git>\cmd or <Git>\bin (or <Git>\mingw64\bin); bash.exe in <Git>\bin.
      for (const git of execFileSync('where.exe', ['git'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).filter(Boolean)) {
        const dir = dirname(git)
        candidates.push(join(dir, '..', 'bin', 'bash.exe'), join(dir, '..', '..', 'bin', 'bash.exe'))
      }
    } catch {}
    candidates.push(join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'))
    const found = candidates.find((c) => existsSync(c))
    if (found) gateBash = found
  }
  return gateBash
}

/** Runs the space's gate command in the integration worktree (shell, 10 min cap). */
export function runGate(cwd: string, command: string, timeoutMs = 600_000): Promise<GateResult> {
  return new Promise((resolve) => {
    execFile(bashPath(), ['-lc', command], { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : null) : 0
      const output = `${stdout}${stderr}`.slice(-8000)
      resolve({ command, ok: !err, exitCode: code, output, at: Date.now() })
    })
  })
}

export interface CombinedDiff {
  base: string
  head: string
  files: { path: string; added: number; removed: number }[]
  patch: string
  commits: number
}

/** Everything the mission would bring to `base`: base...integration. */
export async function combinedDiff(repo: string, mission: string, base: string): Promise<CombinedDiff> {
  const head = integrationBranch(mission)
  const numstat = (await git(repo, ['diff', '--numstat', `${base}...${head}`])).stdout
  const files = numstat.split('\n').filter(Boolean).map((l) => {
    const [a, r, ...p] = l.split('\t')
    return { path: p.join('\t'), added: Number(a) || 0, removed: Number(r) || 0 }
  })
  const patch = (await git(repo, ['diff', `${base}...${head}`])).stdout
  const commits = Number((await git(repo, ['rev-list', '--count', `${base}..${head}`])).stdout) || 0
  return { base, head, files, patch: patch.length > 400_000 ? `${patch.slice(0, 400_000)}\n… (truncated)` : patch, commits }
}

export type MainMergeResult = { ok: true; commit: string } | { ok: false; reason: string }

/** Fast-forwards the owner's checkout of `base` to the integration branch. Refuses rather
 *  than guesses: the checkout must be on `base`, clean, and `base` must not have moved. */
export async function mergeToMain(repo: string, mission: string, base: string): Promise<MainMergeResult> {
  return serialized(repo, async () => {
    const head = integrationBranch(mission)
    const current = (await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout
    if (current !== base) return { ok: false as const, reason: `Your checkout is on "${current}", not "${base}". Switch to ${base} first.` }
    const dirty = (await git(repo, ['status', '--porcelain', '--untracked-files=no'])).stdout
    if (dirty) return { ok: false as const, reason: `Your checkout of ${base} has uncommitted changes:\n${dirty}` }
    const ff = await git(repo, ['merge-base', '--is-ancestor', base, head], { allowFail: true })
    if (ff.code !== 0) return { ok: false as const, reason: `${base} has moved since the mission started; the integration branch no longer fast-forwards. Merge ${base} into ${head} first.` }
    const r = await git(repo, ['merge', '--ff-only', '-q', head], { allowFail: true })
    if (r.code !== 0) return { ok: false as const, reason: `git refused the merge: ${r.stderr || 'unknown error'}` }
    return { ok: true as const, commit: (await git(repo, ['rev-parse', 'HEAD'])).stdout }
  })
}

/** After a merge to main: remove the mission's worktrees and branches (they are in main now). */
/** After a merge to main: remove the worktrees and branches of the workers that are in main
 *  now, and the integration worktree. Anything else (a worker still working, in review or in
 *  conflict) is left exactly as it is. */
export async function cleanupMission(repo: string, mission: string, merged: { path: string; branch: string }[]): Promise<void> {
  return serialized(repo, async () => {
    for (const w of merged) {
      await git(repo, ['worktree', 'remove', '--force', w.path], { allowFail: true })
      await git(repo, ['branch', '-D', w.branch], { allowFail: true })
    }
    await git(repo, ['worktree', 'remove', '--force', integrationPath(repo, mission)], { allowFail: true })
    await git(repo, ['worktree', 'prune'], { allowFail: true })
    await git(repo, ['branch', '-D', integrationBranch(mission)], { allowFail: true })
  })
}

/** One worker's change: base...branch. */
export async function branchDiff(repo: string, base: string, branch: string): Promise<CombinedDiff> {
  const numstat = (await git(repo, ['diff', '--numstat', `${base}...${branch}`])).stdout
  const files = numstat.split('\n').filter(Boolean).map((l) => {
    const [a, r, ...p] = l.split('\t')
    return { path: p.join('\t'), added: Number(a) || 0, removed: Number(r) || 0 }
  })
  const patch = (await git(repo, ['diff', `${base}...${branch}`])).stdout
  const commits = Number((await git(repo, ['rev-list', '--count', `${base}..${branch}`])).stdout) || 0
  return { base, head: branch, files, patch: patch.length > 400_000 ? `${patch.slice(0, 400_000)}\n… (truncated)` : patch, commits }
}

/** Starts merging `integration` into a worker's worktree and leaves the conflict markers
 *  there for the worker to resolve. Its next commit concludes the merge. */
export async function prepareConflict(repo: string, worktree: string, integration: string): Promise<void> {
  return serialized(repo, async () => {
    await git(worktree, [...(await identityArgs(worktree)), 'merge', '--no-ff', '--no-commit', integration], { allowFail: true })
  })
}
