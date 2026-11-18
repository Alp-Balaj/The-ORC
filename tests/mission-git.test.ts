// Free: real git on throwaway repos under orc-sandbox/.orc/git-tests (excluded from the sandbox).
// node --no-warnings tests/mission-git.test.ts
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { addWorktree } from '../src/main/git-worktrees.ts'
import { combinedDiff, commitAll, cleanupMission, ensureIntegration, mergeIntoIntegration, mergeToMain, runGate } from '../src/main/mission-git.ts'

let failed = 0
const ok = (what: string, cond: boolean, d = ''): void => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}${d ? ` — ${d}` : ''}`) }
const root = join(homedir(), 'Documents/Projects/orc-sandbox/.orc/git-tests')
rmSync(root, { recursive: true, force: true })
const g = (cwd: string, ...a: string[]): string => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()

function repo(name: string): string {
  const r = join(root, name)
  mkdirSync(r, { recursive: true })
  g(r, 'init', '-q', '-b', 'main')
  g(r, 'config', 'user.name', 'Test'); g(r, 'config', 'user.email', 't@localhost')
  writeFileSync(join(r, 'shared.txt'), 'one\ntwo\nthree\n')
  g(r, 'add', '.'); g(r, 'commit', '-qm', 'base')
  return r
}

// Happy path, double and empty report_done, concurrent done ------------------
{
  const r = repo('happy')
  const a = await addWorktree(r, 'm', 'a', 'main')
  const b = await addWorktree(r, 'm', 'b', 'main')
  writeFileSync(join(a.path, 'a.txt'), 'hello\n')
  writeFileSync(join(b.path, 'b.txt'), 'world\n')
  const [ca, cb] = await Promise.all([commitAll(r, a.path, 'a: add a.txt'), commitAll(r, b.path, 'b: add b.txt')])
  ok('concurrent commits in one repo both land', !!ca && !!cb)
  ok('a repeated report_done with nothing new commits nothing', (await commitAll(r, a.path, 'again')) === null)
  ok('the owner checkout is untouched', !existsSync(join(r, 'a.txt')) && g(r, 'status', '--porcelain') === '')
  await ensureIntegration(r, 'm', 'main')
  await ensureIntegration(r, 'm', 'main')
  ok('ensureIntegration is idempotent', g(r, 'branch', '--list', 'integration/m') !== '')
  const [ma, mb] = await Promise.all([mergeIntoIntegration(r, 'm', a.branch, 'merge a'), mergeIntoIntegration(r, 'm', b.branch, 'merge b')])
  ok('both workers merge into integration', ma.kind === 'merged' && mb.kind === 'merged', `${ma.kind} ${mb.kind}`)
  ok('merging the same branch again is up to date', (await mergeIntoIntegration(r, 'm', a.branch, 'again')).kind === 'up-to-date')
  const d = await combinedDiff(r, 'm', 'main')
  ok('combined diff lists both files', d.files.map((f) => f.path).sort().join() === 'a.txt,b.txt', d.files.map((f) => f.path).join())
  ok('combined diff has a patch', d.patch.includes('+hello') && d.patch.includes('+world'))
  const gate = await runGate(join(r, '.orc/worktrees/m/_integration'), 'test -f a.txt && test -f b.txt')
  ok('gate passes on the merged result', gate.ok)
  const bad = await runGate(join(r, '.orc/worktrees/m/_integration'), 'echo broken >&2; exit 3')
  ok('a failing gate reports its exit code and output', !bad.ok && bad.exitCode === 3 && bad.output.includes('broken'))

  writeFileSync(join(r, 'shared.txt'), 'dirty\n')
  const dirty = await mergeToMain(r, 'm', 'main')
  ok('merge to main refuses a dirty checkout', !dirty.ok && /uncommitted/.test(dirty.ok ? '' : dirty.reason))
  g(r, 'checkout', '-q', '--', 'shared.txt')
  const done = await mergeToMain(r, 'm', 'main')
  ok('merge to main fast-forwards', done.ok && existsSync(join(r, 'a.txt')) && existsSync(join(r, 'b.txt')))
  await cleanupMission(r, 'm', [a.branch, b.branch])
  ok('cleanup removes worktrees and branches', !existsSync(join(r, '.orc/worktrees/m/a')) && g(r, 'branch', '--list', 'orc/*', 'integration/*') === '')
}

// Conflict ------------------------------------------------------------------
{
  const r = repo('conflict')
  const a = await addWorktree(r, 'c', 'a', 'main')
  const b = await addWorktree(r, 'c', 'b', 'main')
  writeFileSync(join(a.path, 'shared.txt'), 'one\nA\nthree\n')
  writeFileSync(join(b.path, 'shared.txt'), 'one\nB\nthree\n')
  await commitAll(r, a.path, 'a'); await commitAll(r, b.path, 'b')
  await ensureIntegration(r, 'c', 'main')
  await mergeIntoIntegration(r, 'c', a.branch, 'merge a')
  const res = await mergeIntoIntegration(r, 'c', b.branch, 'merge b')
  ok('a conflict is reported with its files', res.kind === 'conflict' && res.files.join() === 'shared.txt', JSON.stringify(res))
  ok('the integration worktree is left clean after a conflict', g(join(r, '.orc/worktrees/c/_integration'), 'status', '--porcelain') === '')
}

// Main moved ----------------------------------------------------------------
{
  const r = repo('moved')
  const a = await addWorktree(r, 'mv', 'a', 'main')
  writeFileSync(join(a.path, 'a.txt'), 'x\n')
  await commitAll(r, a.path, 'a')
  await ensureIntegration(r, 'mv', 'main')
  await mergeIntoIntegration(r, 'mv', a.branch, 'merge a')
  writeFileSync(join(r, 'other.txt'), 'y\n'); g(r, 'add', '.'); g(r, 'commit', '-qm', 'someone else')
  const res = await mergeToMain(r, 'mv', 'main')
  ok('merge to main refuses when main has moved', !res.ok && /moved/.test(res.ok ? '' : res.reason))
  g(r, 'checkout', '-q', '-b', 'feature')
  const res2 = await mergeToMain(r, 'mv', 'main')
  ok('merge to main refuses when the checkout is on another branch', !res2.ok && /not "main"/.test(res2.ok ? '' : res2.reason))
}

rmSync(root, { recursive: true, force: true })
console.log(failed ? `FAIL ${failed}` : 'PASS')
process.exit(failed ? 1 : 0)
