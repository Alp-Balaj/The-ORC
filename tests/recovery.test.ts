// Free: M4 in Missions with fake sessions and real git: save → restore (resume), Pause holds
// spawns/merges/deliveries, the live-agent cap. node --no-warnings tests/recovery.test.ts
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Missions } from '../src/main/missions.ts'
import type { TerminalHost } from '../src/main/terminals.ts'

let failed = 0
const ok = (what: string, cond: boolean, d = ''): void => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}${d ? ` — ${d}` : ''}`) }
const root = join(homedir(), 'Documents/Projects/orc-sandbox/.orc/recovery-tests')
rmSync(root, { recursive: true, force: true })
const g = (cwd: string, ...a: string[]): string => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
function repo(name: string): string {
  const r = join(root, name)
  mkdirSync(r, { recursive: true })
  g(r, 'init', '-q', '-b', 'main'); g(r, 'config', 'user.name', 'T'); g(r, 'config', 'user.email', 't@l')
  writeFileSync(join(r, 'x.txt'), 'x\n'); g(r, 'add', '.'); g(r, 'commit', '-qm', 'base')
  return r
}
const transcript = fileURLToPath(new URL('fixtures/transcript-worker.jsonl', import.meta.url))
function world() {
  const launches: { id: string; args: string[] }[] = []
  const typed: { id: string; data: string }[] = []
  const running = new Set<string>()
  const host = {
    start: (s: { id: string; args: string[] }) => { launches.push({ id: s.id, args: s.args }); running.add(s.id) },
    kill: (id: string) => running.delete(id), killAll: () => running.clear(), pid: () => 4242,
    isRunning: (id: string) => running.has(id), write: (id: string, data: string) => typed.push({ id, data })
  } as unknown as TerminalHost
  const m = new Missions(host, () => {})
  m.verify = async () => ({ ok: true, report: 'VERDICT: PASS', promptHash: 'h' }) // never a billed claude -p
  return { m, launches, typed }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const hook = (m: Missions, t: string, e: Record<string, unknown>) => m.hookEvent(t, e as never)

// Save → restore ---------------------------------------------------------------
const r = repo('persist')
const w1 = world()
const id = await w1.m.startMission({ repoPath: r, name: 'persist', permissionMode: 'acceptEdits', gating: 'none' })
const c = `${id}:coordinator`
hook(w1.m, c, { hook_event_name: 'SessionStart', transcript_path: transcript })
hook(w1.m, c, { hook_event_name: 'UserPromptSubmit', prompt: 'two files please' })
await w1.m.spawnAgent(c, 'a', 'Create a.txt'); await w1.m.spawnAgent(c, 'fresh', 'Never got going')
hook(w1.m, `${id}:a`, { hook_event_name: 'UserPromptSubmit', prompt: 'Create a.txt', transcript_path: transcript })
hook(w1.m, `${id}:a`, { hook_event_name: 'PreToolUse', tool_name: 'Write' })
w1.m.askHuman(c, 'Which colour?')
const saved = JSON.parse(JSON.stringify(w1.m.snapshot()))
ok('the snapshot carries no bearer tokens', !JSON.stringify(saved).match(/"token":"[0-9a-f]{48}"/) && !JSON.stringify(saved).includes('"token"'))

const w2 = world()
const killed: number[] = []
const log = await w2.m.restore(saved, { isOrphan: (pid, sid) => pid === 4242 && sid === saved.missions[0].agents[0].sessionId, kill: (pid) => killed.push(pid) })
const v = () => w2.m.views()[0]
ok('the mission comes back with its agents', v()?.agents.length === 3, log.join(' | '))
ok('an orphan still carrying the session id is killed (and only that one)', killed.length === 1)
const argsOf = (agent: string) => w2.launches.find((l) => l.id === `${id}:${agent}`)?.args ?? []
ok('agents that had a turn are resumed with --resume <session id>', argsOf('a').join(' ').includes(`--resume ${v().agents.find((x) => x.name === 'a')!.sessionId}`) && !argsOf('a').includes('--session-id'))
ok('an agent that never had a turn is started fresh, with its task again', argsOf('fresh').includes('--session-id') && argsOf('fresh')[0] === 'Never got going')
ok('resumed sessions get fresh tokens', !argsOf('a').join(' ').includes(String(saved.missions[0].agents[1].token)))
ok('a turn cut off by the restart is over: working → idle', v().agents.find((x) => x.name === 'a')!.status === 'idle')
ok('a pending question survives the restart', v().agents.find((x) => x.name === 'coordinator')!.status === 'needs-you' && !!v().agents.find((x) => x.name === 'coordinator')!.question)
ok('the brief and the feed survive', v().feed.some((f) => f.kind === 'spawn') && v().feed.some((f) => f.kind === 'orc' && /resumed/.test(f.text)))
const t2 = w2.m.agentForToken(/Bearer ([0-9a-f]+)/.exec(argsOf('a').join(' '))![1])
ok('the new token maps to the right agent', t2 === `${id}:a`)
await w2.m.restore(saved, { isOrphan: () => false, kill: () => {} })
ok('restoring twice is a no-op', w2.m.views().length === 1)

// Pause -------------------------------------------------------------------------
{
  const r2 = repo('pause')
  const { m, typed } = world()
  const pid = await m.startMission({ repoPath: r2, name: 'pause', permissionMode: 'acceptEdits', gating: 'none' })
  const pc = `${pid}:coordinator`
  await m.spawnAgent(pc, 'a', 'x')
  const wa = m.views()[0].agents.find((x) => x.name === 'a')!
  hook(m, wa.terminalId, { hook_event_name: 'UserPromptSubmit', prompt: 'x' })
  hook(m, pc, { hook_event_name: 'Stop' })
  m.pauseMission(pid)
  ok('pause sends Esc to agents mid-turn only', typed.some((t) => t.id === wa.terminalId && t.data === '\x1b') && !typed.some((t) => t.id === pc && t.data === '\x1b'))
  ok('pause refuses spawns', /paused/.test(await m.spawnAgent(pc, 'b', 'y')))
  hook(m, wa.terminalId, { hook_event_name: 'Stop' })
  writeFileSync(join(wa.cwd, 'a.txt'), 'a\n')
  m.reportDone(wa.terminalId, 'a'); await m.gitWork
  ok('a report while paused is committed but its merge is held', m.views()[0].merged.length === 0 && m.views()[0].feed.some((f) => /held/.test(f.text)))
  m.decideSplit(pid, true, null)
  const before = typed.length
  ;(m as unknown as { deliver: (a: unknown, t: string) => void }).deliver((m as unknown as { byTerminal: Map<string, unknown> }).byTerminal.get(pc), '[The ORC] hello')
  ok('pause holds deliveries', typed.length === before)
  m.resumeMission(pid); await m.gitWork; await sleep(1500)
  ok('resume merges the held work', m.views()[0].merged.join() === 'a')
  ok('resume delivers held notes', typed.some((t) => t.id === pc && t.data.includes('[The ORC] hello')))
}

// Pause + checkpointed, and held work across a restart --------------------------------
{
  const r4 = repo('pausecheck')
  const { m } = world()
  const pid = await m.startMission({ repoPath: r4, name: 'pchk', permissionMode: 'acceptEdits', gating: 'checkpointed' })
  await m.spawnAgent(`${pid}:coordinator`, 'a', 'x')
  const wa = m.views()[0].agents.find((x) => x.name === 'a')!
  m.pauseMission(pid)
  writeFileSync(join(wa.cwd, 'a.txt'), 'a\n')
  m.reportDone(wa.terminalId, 'a'); await m.gitWork
  m.resumeMission(pid); await m.gitWork
  ok('resume sends held checkpointed work to review, not straight to merge', m.views()[0].agents.find((x) => x.name === 'a')!.merge === 'review' && m.views()[0].merged.length === 0)

  const r5 = repo('heldrestart')
  const w = world()
  const hid = await w.m.startMission({ repoPath: r5, name: 'held', permissionMode: 'acceptEdits', gating: 'none' })
  await w.m.spawnAgent(`${hid}:coordinator`, 'a', 'x')
  const ha = w.m.views()[0].agents.find((x) => x.name === 'a')!
  w.m.pauseMission(hid)
  writeFileSync(join(ha.cwd, 'a.txt'), 'a\n')
  w.m.reportDone(ha.terminalId, 'a'); await w.m.gitWork
  const snap = JSON.parse(JSON.stringify(w.m.snapshot()))
  const w2b = world()
  await w2b.m.restore(snap, { isOrphan: () => false, kill: () => {} }); await w2b.m.gitWork
  ok('a restart while paused keeps the work held', w2b.m.views()[0].merged.length === 0 && w2b.m.views()[0].paused)
  w2b.m.resumeMission(hid); await w2b.m.gitWork
  ok('…and resume after the restart merges it', w2b.m.views()[0].merged.join() === 'a')
  ok('stopped missions can be removed; running ones cannot', !w2b.m.removeMission(hid) && (w2b.m.stopMission(hid), w2b.m.removeMission(hid)) && w2b.m.views().length === 0)
}

// Live-agent cap ------------------------------------------------------------------
{
  const r3 = repo('cap')
  const { m } = world()
  m.liveLimitFor = () => 2
  const cid = await m.startMission({ repoPath: r3, name: 'cap', permissionMode: 'acceptEdits', gating: 'none' })
  ok('under the cap a worker starts', /Started worker/.test(await m.spawnAgent(`${cid}:coordinator`, 'a', 'x')))
  ok('at the cap spawn is refused with the numbers', /2 live agents/.test(await m.spawnAgent(`${cid}:coordinator`, 'b', 'y')))
  let threw = ''
  try { await m.startMission({ repoPath: r3, name: 'cap2', permissionMode: 'acceptEdits' }) } catch (e) { threw = String(e) }
  ok('a new mission in a full space is refused', /live agents/.test(threw), threw)
  m.reportDone(`${cid}:a`, 'nothing to do'); await m.gitWork
  ok('a done worker frees its slot', /Started worker/.test(await m.spawnAgent(`${cid}:coordinator`, 'b', 'y')))
}

rmSync(root, { recursive: true, force: true })
console.log(failed ? `FAIL ${failed}` : 'PASS')
process.exit(failed ? 1 : 0)
