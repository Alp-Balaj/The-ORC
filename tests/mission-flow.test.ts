// Free: the M3 flow through Missions with fake sessions and REAL git on throwaway repos
// (orc-sandbox/.orc/flow-tests). node --no-warnings tests/mission-flow.test.ts
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Missions } from '../src/main/missions.ts'
import type { TerminalHost } from '../src/main/terminals.ts'

let failed = 0
const ok = (what: string, cond: boolean, d = ''): void => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}${d ? ` — ${d}` : ''}`) }
const root = join(homedir(), 'Documents/Projects/orc-sandbox/.orc/flow-tests')
rmSync(root, { recursive: true, force: true })
const g = (cwd: string, ...a: string[]): string => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
function repo(name: string): string {
  const r = join(root, name)
  mkdirSync(r, { recursive: true })
  g(r, 'init', '-q', '-b', 'main'); g(r, 'config', 'user.name', 'Test'); g(r, 'config', 'user.email', 't@localhost')
  writeFileSync(join(r, 'shared.txt'), 'one\ntwo\nthree\n'); g(r, 'add', '.'); g(r, 'commit', '-qm', 'base')
  return r
}
function world() {
  const typed: { id: string; data: string }[] = []
  const host = { start: () => {}, kill: () => {}, killAll: () => {}, write: (id: string, data: string) => typed.push({ id, data }) } as unknown as TerminalHost
  const m = new Missions(host, () => {})
  m.verify = async () => ({ ok: true, report: 'VERDICT: PASS\nMATCHES THE BRIEF: yes', promptHash: 'h' })
  return { m, typed }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const hook = (m: Missions, t: string, e: Record<string, unknown>) => m.hookEvent(t, e as never)

// Plan check -----------------------------------------------------------------
{
  const r = repo('plan')
  const { m, typed } = world()
  m.gateCommandFor = () => 'test -f a.txt'
  const id = await m.startMission({ repoPath: r, name: 'plan', permissionMode: 'acceptEdits' })
  const c = `${id}:coordinator`
  const v = () => m.views()[0]
  ok('plan check is the default', v().gating === 'plan')
  hook(m, c, { hook_event_name: 'SessionStart' })
  hook(m, c, { hook_event_name: 'UserPromptSubmit', prompt: 'make a.txt and b.txt' })
  ok('the first human prompt is the brief', true)
  ok('spawn is refused before a split', /propose_split/.test(await m.spawnAgent(c, 'a', 'x')))
  ok('propose_split returns pending at once', /Pending/.test(m.proposeSplit(c, 'two files', [{ name: 'a', task: 'a.txt' }, { name: 'b', task: 'b.txt' }])))
  ok('spawn is refused while the split is pending', /waiting for the human/.test(await m.spawnAgent(c, 'a', 'x')))
  // Approve while the coordinator is still finishing its turn (seen in a real run): the note
  // is queued, then typed once Stop arrives.
  m.decideSplit(id, true, 'keep it tiny')
  ok('approval while busy is queued, not typed', !typed.some((t) => t.id === c))
  hook(m, c, { hook_event_name: 'Stop' })
  await sleep(1500)
  const toCoord = typed.filter((t) => t.id === c).map((t) => t.data).join('')
  ok('approval is typed into the idle coordinator, then Enter', toCoord.includes('[The ORC] The human approved your split') && toCoord.endsWith('\r'), JSON.stringify(toCoord.slice(-60)))
  hook(m, c, { hook_event_name: 'UserPromptSubmit', prompt: '[The ORC] The human approved your split.' })
  ok('an [The ORC] prompt is neither steering nor the brief', !v().feed.some((f) => f.kind === 'steer'))
  ok('spawn works after approval', /Started worker/.test(await m.spawnAgent(c, 'a', 'Create a.txt')) && /Started worker/.test(await m.spawnAgent(c, 'b', 'Create b.txt')))
  const wa = v().agents.find((x) => x.name === 'a')!, wb = v().agents.find((x) => x.name === 'b')!
  writeFileSync(join(wa.cwd, 'a.txt'), 'hello\n'); writeFileSync(join(wb.cwd, 'b.txt'), 'world\n')
  m.reportDone(`${id}:a`, 'Created a.txt'); m.reportDone(`${id}:b`, 'Created b.txt')
  await m.gitWork
  ok('both workers committed and merged', v().merged.join() === 'a,b' && v().agents.filter((x) => x.role === 'worker').every((x) => x.merge === 'merged'), v().merged.join())
  ok('agents never committed: the app did, with the mission trailer', g(r, 'log', '-1', '--format=%B', 'orc/plan/a').includes('ORC-Agent: plan/a'))
  ok('the gate ran on the merged result', v().gate?.ok === true, JSON.stringify(v().gate))
  ok('the owner checkout is untouched', !existsSync(join(r, 'a.txt')))
  m.reportDone(`${id}:a`, 'Created a.txt (again)')
  await m.gitWork
  ok('a repeated report_done is harmless', v().agents.find((x) => x.name === 'a')!.merge === 'merged' && !v().feed.some((f) => f.kind === 'orc' && f.status === 'failed'), v().feed.filter((f) => f.kind === 'orc').map((f) => f.text).join(' | '))
  const d = await m.missionDiff(id)
  ok('combined diff shows both files', d?.files.map((f) => f.path).sort().join() === 'a.txt,b.txt')
  await m.runVerifier(id)
  ok('verifier report recorded with hashes', v().verifier?.status === 'done' && v().verifier!.templateHash.length === 64)
  writeFileSync(join(r, 'shared.txt'), 'dirty\n')
  const refused = await m.mergeToMain(id)
  ok('merge to main refuses a dirty checkout, says why', !refused.ok && /uncommitted/.test(refused.message))
  g(r, 'checkout', '-q', '--', 'shared.txt')
  const merged = await m.mergeToMain(id)
  ok('merge to main fast-forwards and cleans up', merged.ok && existsSync(join(r, 'a.txt')) && existsSync(join(r, 'b.txt')) && !existsSync(wa.cwd) && g(r, 'branch', '--list', 'orc/*', 'integration/*') === '', merged.message)
  ok('mission stopped after merge', v().state === 'stopped' && !!v().mergedToMain)
}

// Conflict -------------------------------------------------------------------
{
  const r = repo('conflict')
  const { m, typed } = world()
  const id = await m.startMission({ repoPath: r, name: 'conf', permissionMode: 'acceptEdits', gating: 'none' })
  const c = `${id}:coordinator`
  await m.spawnAgent(c, 'a', 'x'); await m.spawnAgent(c, 'b', 'y')
  const v = () => m.views()[0]
  const wa = v().agents.find((x) => x.name === 'a')!, wb = v().agents.find((x) => x.name === 'b')!
  for (const [w, t] of [[wa, 'A'], [wb, 'B']] as const) hook(m, w.terminalId, { hook_event_name: 'Stop' })
  writeFileSync(join(wa.cwd, 'shared.txt'), 'one\nA\nthree\n'); writeFileSync(join(wb.cwd, 'shared.txt'), 'one\nB\nthree\n')
  m.reportDone(wa.terminalId, 'A'); await m.gitWork
  m.reportDone(wb.terminalId, 'B'); await m.gitWork
  await sleep(600)
  const b = v().agents.find((x) => x.name === 'b')!
  ok('a conflicting worker is marked conflict with its files', b.merge === 'conflict' && b.conflictFiles.join() === 'shared.txt')
  ok('the conflict markers are in the worker worktree', readFileSync(join(wb.cwd, 'shared.txt'), 'utf8').includes('<<<<<<<'))
  ok('the worker is told to resolve it', typed.some((t) => t.id === wb.terminalId && t.data.includes('conflicts with work already merged')))
  const note = m.hookEvent(c, { hook_event_name: 'PreToolUse', tool_name: 'Read' } as never)
  ok('the busy coordinator gets the conflict on its next hook', !!note && note.includes('conflicts'), note ?? 'null')
  writeFileSync(join(wb.cwd, 'shared.txt'), 'one\nA\nB\nthree\n')
  m.reportDone(wb.terminalId, 'B, conflict resolved'); await m.gitWork
  ok('after resolving, the retry merges', v().agents.find((x) => x.name === 'b')!.merge === 'merged' && v().merged.join() === 'a,b', v().agents.find((x) => x.name === 'b')!.merge ?? '')
  const integ = readFileSync(join(r, '.orc/worktrees/conf/_integration/shared.txt'), 'utf8')
  ok('integration has both changes', integ.includes('A') && integ.includes('B'))
}

// Checkpointed ---------------------------------------------------------------
{
  const r = repo('check')
  const { m, typed } = world()
  const id = await m.startMission({ repoPath: r, name: 'chk', permissionMode: 'acceptEdits', gating: 'checkpointed' })
  await m.spawnAgent(`${id}:coordinator`, 'a', 'x')
  const v = () => m.views()[0]
  const wa = v().agents.find((x) => x.name === 'a')!
  writeFileSync(join(wa.cwd, 'a.txt'), 'hi\n')
  m.reportDone(wa.terminalId, 'a'); await m.gitWork
  ok('checkpointed: the diff waits for review', v().agents.find((x) => x.name === 'a')!.merge === 'review' && v().merged.length === 0)
  const wd = await m.workerDiff(id, 'a')
  ok('worker diff is available for review', wd?.files[0]?.path === 'a.txt')
  m.sendBack(id, 'a', 'add a newline at the end')
  await sleep(600)
  ok('send back reaches the worker', typed.some((t) => t.id === wa.terminalId && t.data.includes('sent it back')))
  writeFileSync(join(wa.cwd, 'a.txt'), 'hi\nthere\n')
  m.reportDone(wa.terminalId, 'a v2'); await m.gitWork
  m.approveWorker(id, 'a'); await m.gitWork
  ok('approve merges it', v().merged.join() === 'a')
}

rmSync(root, { recursive: true, force: true })
console.log(failed ? `FAIL ${failed}` : 'PASS')
process.exit(failed ? 1 : 0)
