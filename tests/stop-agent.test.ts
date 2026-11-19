// Free: the coordinator shuts down finished workers with stop_agent. Fake sessions, real git on
// throwaway repos (orc-sandbox/.orc/stop-tests). node --no-warnings tests/stop-agent.test.ts
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Missions } from '../src/main/missions.ts'
import type { TerminalHost } from '../src/main/terminals.ts'

let failed = 0
const ok = (what: string, cond: boolean, d = ''): void => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}${d ? ` — ${d}` : ''}`) }
const root = join(homedir(), 'Documents/Projects/orc-sandbox/.orc/stop-tests')
rmSync(root, { recursive: true, force: true })
const g = (cwd: string, ...a: string[]): string => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
function repo(name: string): string {
  const r = join(root, name)
  mkdirSync(r, { recursive: true })
  g(r, 'init', '-q', '-b', 'main'); g(r, 'config', 'user.name', 'T'); g(r, 'config', 'user.email', 't@l')
  writeFileSync(join(r, 'x.txt'), 'x\n'); g(r, 'add', '.'); g(r, 'commit', '-qm', 'base')
  return r
}
function world() {
  const launches: string[] = []
  const args: Record<string, string[]> = {}
  const killed: string[] = []
  const typed: { id: string; data: string }[] = []
  const running = new Set<string>()
  const host = {
    start: (s: { id: string; args: string[] }) => { launches.push(s.id); args[s.id] = s.args; running.add(s.id) },
    kill: (id: string) => { killed.push(id); running.delete(id) }, killAll: () => running.clear(), pid: () => null,
    isRunning: (id: string) => running.has(id), write: (id: string, data: string) => typed.push({ id, data })
  } as unknown as TerminalHost
  return { m: new Missions(host, () => {}), launches, args, killed, typed }
}
const hook = (m: Missions, t: string, e: Record<string, unknown>) => m.hookEvent(t, e as never)

{
  const r = repo('stop')
  const w = world()
  const { m, killed } = w
  const id = await m.startMission({ repoPath: r, name: 'stop', permissionMode: 'acceptEdits', gating: 'none' })
  const c = `${id}:coordinator`
  const agent = (n: string) => m.views()[0].agents.find((x) => x.name === n)!
  await m.spawnAgent(c, 'a', 'Create a.txt')
  await m.spawnAgent(c, 'b', 'Create b.txt')
  hook(m, `${id}:a`, { hook_event_name: 'SessionStart' })

  ok('a worker that has not reported is not stopped', /not reported done/.test(m.stopAgent(c, 'a', null)) && killed.length === 0)
  ok('an unknown worker is refused', /no worker named/.test(m.stopAgent(c, 'zzz', null)))
  ok('the coordinator cannot be stopped', /no worker named/.test(m.stopAgent(`${id}:a`, 'coordinator', null)))
  ok('a sibling cannot stop another worker', /Only the coordinator/.test(m.stopAgent(`${id}:b`, 'a', null)))

  writeFileSync(join(agent('a').cwd, 'a.txt'), 'a\n')
  m.reportDone(`${id}:a`, 'Created a.txt')
  ok('reported but still being committed: refused', /still committing/.test(m.stopAgent(c, 'a', null)) && killed.length === 0)
  await m.gitWork
  ok('a is merged', agent('a').merge === 'merged')
  const reply = m.stopAgent(c, 'stop/a', 'all done')
  ok('a merged worker is stopped, by session name too', /Stopped "stop\/a"/.test(reply), reply)
  ok('its terminal was killed', killed.join() === `${id}:a`)
  ok('it shows as exited, with its report and merge kept', agent('a').status === 'exited' && agent('a').doneSummary === 'Created a.txt' && agent('a').merge === 'merged')
  ok('the feed says who stopped it and why', m.views()[0].feed.some((f) => f.kind === 'stopped' && f.from === 'coordinator' && f.to === 'a' && /all done/.test(f.text)))
  m.terminalExited(`${id}:a`, 0)
  hook(m, `${id}:a`, { hook_event_name: 'SessionEnd' })
  ok('its exit and SessionEnd leave it exited', agent('a').status === 'exited')
  ok('stopping it again is harmless', /already stopped/.test(m.stopAgent(c, 'a', null)) && killed.length === 1)
  w.typed.length = 0
  m.deliver((m as unknown as { missions: Map<string, { agents: Map<string, never> }> }).missions.get(id)!.agents.get('a')!, '[The ORC] hello')
  ok('nothing is typed into a stopped worker', w.typed.length === 0)

  // A restart must not bring it back.
  const snap = JSON.parse(JSON.stringify(m.snapshot()))
  const w2 = world()
  await w2.m.restore(snap, { isOrphan: () => false, kill: () => {} })
  ok('a restart does not resume a stopped worker', !w2.launches.includes(`${id}:a`) && w2.launches.includes(`${id}:b`), w2.launches.join())
}

// Checkpointed: a diff awaiting review may be sent back, so the worker must stay.
{
  const r = repo('review')
  const { m, killed } = world()
  const id = await m.startMission({ repoPath: r, name: 'review', permissionMode: 'acceptEdits', gating: 'checkpointed' })
  const c = `${id}:coordinator`
  await m.spawnAgent(c, 'a', 'Create a.txt')
  writeFileSync(join(m.views()[0].agents.find((x) => x.name === 'a')!.cwd, 'a.txt'), 'a\n')
  m.reportDone(`${id}:a`, 'Created a.txt'); await m.gitWork
  ok('a diff awaiting review is not stopped', /waiting for the human/.test(m.stopAgent(c, 'a', null)) && killed.length === 0)
  m.approveWorker(id, 'a'); await m.gitWork
  ok('…and is stopped once approved and merged', /Stopped/.test(m.stopAgent(c, 'a', null)))
}

// Sub-workers: a parent can stop its own worker; a worker with live sub-workers can't be stopped.
{
  const r = repo('nested')
  const { m } = world()
  const id = await m.startMission({ repoPath: r, name: 'nested', permissionMode: 'acceptEdits', gating: 'none' })
  const c = `${id}:coordinator`
  await m.spawnAgent(c, 'lead', 'lead the api')
  await m.spawnAgent(`${id}:lead`, 'sub', 'write the tests')
  m.reportDone(`${id}:lead`, 'nothing to do'); m.reportDone(`${id}:sub`, 'nothing to do'); await m.gitWork
  ok('a worker with running sub-workers is not stopped', /running workers of its own \(sub\)/.test(m.stopAgent(c, 'lead', null)))
  ok('a parent stops its own sub-worker', /Stopped/.test(m.stopAgent(`${id}:lead`, 'sub', null)))
  ok('…then the parent can be stopped', /Stopped/.test(m.stopAgent(c, 'lead', null)))
}

// The per-mission cap counts running agents only.
{
  const r = repo('cap')
  const { m } = world()
  m.maxAgentsPerMission = 2
  const id = await m.startMission({ repoPath: r, name: 'cap', permissionMode: 'acceptEdits', gating: 'none' })
  const c = `${id}:coordinator`
  await m.spawnAgent(c, 'a', 'x')
  ok('at the mission cap spawn is refused and points at stop_agent', /stop_agent/.test(await m.spawnAgent(c, 'b', 'y')))
  m.reportDone(`${id}:a`, 'nothing to do'); await m.gitWork
  m.stopAgent(c, 'a', null)
  ok('a stopped worker makes room for another', /Started worker/.test(await m.spawnAgent(c, 'b', 'y')))
}

// The human's Stop button: works before the job is finished, and tells the parent.
{
  const r = repo('human')
  const { m, killed, typed } = world()
  const id = await m.startMission({ repoPath: r, name: 'human', permissionMode: 'acceptEdits', gating: 'none' })
  const c = `${id}:coordinator`
  await m.spawnAgent(c, 'a', 'Create a.txt')
  await m.spawnAgent(c, 'lead', 'lead')
  await m.spawnAgent(`${id}:lead`, 'sub', 'tests')
  const agent = (n: string) => m.views()[0].agents.find((x) => x.name === n)!
  let threw = ''
  try { m.stopWorker(id, 'lead') } catch (e) { threw = String(e) }
  ok('the human cannot stop a worker with running sub-workers', /sub/.test(threw) && agent('lead').status !== 'exited', threw)
  threw = ''
  try { m.stopWorker(id, 'coordinator') } catch (e) { threw = String(e) }
  ok('the coordinator has no Stop', /no worker/.test(threw))
  m.stopWorker(id, 'a')
  ok('an unfinished worker is stopped by the human', killed.includes(`${id}:a`) && agent('a').status === 'exited' && agent('a').shutDown === true && agent('a').activity === 'shut down by you')
  ok('the feed says it was not merged', m.views()[0].feed.some((f) => f.kind === 'stopped' && f.from === 'you' && /before its work was merged/.test(f.text)))
  const out = hook(m, c, { hook_event_name: 'PreToolUse', tool_name: 'Read' }) ?? ''
  ok('its coordinator is told on its next hook, nothing typed', /stopped your worker \\"human\/a\\"/.test(out) && !typed.some((t) => t.id === c), out)
}

// Stop mission by mistake → Restart brings the sessions back; shut-down workers stay down.
{
  const transcript = fileURLToPath(new URL('fixtures/transcript-worker.jsonl', import.meta.url))
  const r = repo('restart')
  const { m, launches, args } = world()
  const id = await m.startMission({ repoPath: r, name: 'restart', permissionMode: 'acceptEdits', gating: 'none' })
  const c = `${id}:coordinator`
  hook(m, c, { hook_event_name: 'SessionStart', transcript_path: transcript })
  await m.spawnAgent(c, 'a', 'Create a.txt')
  await m.spawnAgent(c, 'b', 'Create b.txt')
  await m.spawnAgent(c, 'gone', 'nothing')
  m.reportDone(`${id}:b`, 'nothing to do'); m.reportDone(`${id}:gone`, 'nothing to do'); await m.gitWork
  m.stopAgent(c, 'gone', null)
  hook(m, c, { hook_event_name: 'UserPromptSubmit', prompt: 'go' })
  m.stopMission(id)
  const v = () => m.views()[0]
  ok('stop mission ended it', v().state === 'stopped' && v().agents.find((x) => x.name === 'a')!.status === 'exited')
  launches.length = 0
  await m.restartMission(id)
  ok('restart puts the mission back to running', v().state === 'running')
  ok('…relaunches every session Stop ended', [`${id}:coordinator`, `${id}:a`, `${id}:b`].every((t) => launches.includes(t)), launches.join())
  ok('…but not a worker that was shut down on its own', !launches.includes(`${id}:gone`) && v().agents.find((x) => x.name === 'gone')!.status === 'exited')
  ok('the coordinator resumes its conversation', args[c].includes('--resume'))
  ok('a worker with no turn yet gets its task again', args[`${id}:a`][0] === 'Create a.txt' && !args[`${id}:a`].includes('--resume'))
  ok('a worker that had reported stays done', v().agents.find((x) => x.name === 'b')!.status === 'done')
  ok('the coordinator comes back idle', v().agents.find((x) => x.name === 'coordinator')!.status === 'idle')
  ok('the feed says so', v().feed.some((f) => /mission restarted/.test(f.text)))
  m.stopMission(id)
  m.liveLimitFor = () => 1
  let threw = ''
  try { await m.restartMission(id) } catch (e) { threw = String(e) }
  ok("restart respects the space's live-agent cap", /live agents/.test(threw) && v().state === 'stopped', threw)
}

// Restart right after Stop: the real host's kill only signals, the exit arrives later.
{
  const r = repo('race')
  const running = new Set<string>()
  const launches: string[] = []
  let m: Missions
  const host = {
    start: (s: { id: string }) => { if (running.has(s.id)) throw new Error(`terminal ${s.id} already running`); launches.push(s.id); running.add(s.id) },
    // Exit 300 ms after the signal, as node-pty's onExit does.
    kill: (id: string) => setTimeout(() => { running.delete(id); m.terminalExited(id, 0) }, 300),
    killAll: () => running.clear(), pid: () => null, isRunning: (id: string) => running.has(id), write: () => {}
  } as unknown as TerminalHost
  m = new Missions(host, () => {})
  const id = await m.startMission({ repoPath: r, name: 'race', permissionMode: 'acceptEdits', gating: 'none' })
  await m.spawnAgent(`${id}:coordinator`, 'a', 'x')
  m.stopMission(id)
  launches.length = 0
  await m.restartMission(id)
  await new Promise((res) => setTimeout(res, 500))
  const v = m.views()[0]
  ok('Restart right after Stop waits for the exits, then relaunches', launches.length === 2 && v.state === 'running' && v.agents.every((a) => a.status !== 'exited'), `${launches.length} ${v.agents.map((a) => a.status).join()}`)
}

// A worker stopped while its diff waits for review: approving still merges it, and a conflict
// never brings it back to life.
for (const conflict of [false, true]) {
  const r = repo(conflict ? 'stopped-conflict' : 'stopped-clean')
  const w = world()
  const { m } = w
  const id = await m.startMission({ repoPath: r, name: conflict ? 'sc' : 'sk', permissionMode: 'acceptEdits', gating: 'checkpointed' })
  const c = `${id}:coordinator`
  await m.spawnAgent(c, 'a', 'x'); await m.spawnAgent(c, 'b', 'y')
  const agent = (n: string) => m.views()[0].agents.find((x) => x.name === n)!
  writeFileSync(join(agent('a').cwd, 'x.txt'), 'from a\n')
  writeFileSync(join(agent('b').cwd, conflict ? 'x.txt' : 'b.txt'), 'from b\n')
  m.reportDone(`${id}:a`, 'a'); m.reportDone(`${id}:b`, 'b'); await m.gitWork
  m.approveWorker(id, 'a'); await m.gitWork
  const token = (m as unknown as { missions: Map<string, { agents: Map<string, { token: string }> }> }).missions.get(id)!.agents.get('b')!.token
  ok(`${conflict ? 'conflict' : 'clean'}: its token works before the stop`, m.agentForToken(token) === `${id}:b`)
  m.stopWorker(id, 'b')
  const out = m.hookEvent(`${id}:b`, { hook_event_name: 'Stop' } as never)
  ok(`${conflict ? 'conflict' : 'clean'}: a hook arriving after the stop changes nothing`, out === null && agent('b').status === 'exited')
  ok(`${conflict ? 'conflict' : 'clean'}: its token no longer works`, m.agentForToken(token) === null)
  m.approveWorker(id, 'b'); await m.gitWork
  if (!conflict) ok('clean: approving a stopped worker still merges it', agent('b').merge === 'merged' && m.views()[0].merged.includes('b'))
  else {
    ok('conflict: a stopped worker stays exited, not merged', agent('b').status === 'exited' && agent('b').merge === 'conflict' && !m.views()[0].merged.includes('b'), `${agent('b').status} ${agent('b').merge}`)
    ok('conflict: its worktree is left without conflict markers', readFileSync(join(agent('b').cwd, 'x.txt'), 'utf8') === 'from b\n')
    ok('conflict: the feed tells you', m.views()[0].feed.some((f) => f.kind === 'conflict' && /is stopped/.test(f.text)))
    const snap = JSON.parse(JSON.stringify(m.snapshot()))
    const w2 = world()
    await w2.m.restore(snap, { isOrphan: () => false, kill: () => {} })
    ok('conflict: a restart does not resume it', !w2.launches.includes(`${id}:b`))
  }
}

rmSync(root, { recursive: true, force: true })
console.log(failed ? `FAIL ${failed}` : 'PASS')
process.exit(failed ? 1 : 0)
