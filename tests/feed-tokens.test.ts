// Free: replays recorded hook payloads (tests/fixtures) through Missions with fake sessions
// and fake git, and checks the feed, token counts, steering notes and name rules.
// node --no-warnings tests/feed-tokens.test.ts
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { Missions } from '../src/main/missions.ts'
import type { TerminalHost } from '../src/main/terminals.ts'
import { TranscriptTally } from '../src/main/tokens.ts'

let failed = 0
const ok = (what: string, cond: boolean, detail = ''): void => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`)
}
const fixture = (f: string) => JSON.parse(readFileSync(new URL(`fixtures/${f}`, import.meta.url), 'utf8')) as Record<string, any>[]

// Tokens -------------------------------------------------------------------
const tally = new TranscriptTally(fileURLToPath(new URL('fixtures/transcript-worker.jsonl', import.meta.url)))
const c = await tally.update()
ok('transcript tokens = input + cache writes + output, deduped by message id', c.tokens === 8 + 26032 + 923, String(c.tokens))
ok('context = latest message input + cache', c.contextTokens > 26000 && c.contextTokens < 60000, String(c.contextTokens))
const again = await tally.update()
ok('re-reading an unchanged file changes nothing', again.tokens === c.tokens)

// A fake world --------------------------------------------------------------
function world() {
  const host = { start: () => {}, kill: () => {}, killAll: () => {}, pid: () => null, isRunning: () => true, write: () => {} } as unknown as TerminalHost
  const m = new Missions(host, () => {})
  m.verify = async () => ({ ok: true, report: 'VERDICT: PASS', promptHash: 'h' })
  const branches = new Set<string>()
  m.git = {
    ...m.git,
    repoRoot: async (p: string) => p,
    currentBranch: async () => 'main',
    branchesUnder: async (_r: string, prefix: string) => [...branches].filter((b) => b.startsWith(prefix)),
    addWorktree: async (repo: string, mission: string, agent: string) => {
      branches.add(`orc/${mission}/${agent}`)
      return { path: `${repo}/.orc/worktrees/${mission}/${agent}`, branch: `orc/${mission}/${agent}` }
    }
  }
  return { m, branches }
}

/** Replays a recorded run: spawn_agent calls go through spawnAgent, every other event to hookEvent. */
async function replay(file: string, missionName: string) {
  const { m } = world()
  const id = await m.startMission({ repoPath: '/repo', name: missionName, permissionMode: 'acceptEdits', gating: 'none' })
  const term = (agent: string) => `${id}:${agent}`
  for (const e of fixture(file)) {
    const agent = String(e.agent).split(':')[1]
    if (e.hook_event_name === 'PostToolUse' && e.tool_name === 'mcp__orc__spawn_agent') {
      await m.spawnAgent(term(agent), e.tool_input.name, e.tool_input.task)
    }
    if (e.hook_event_name === 'PostToolUse' && e.tool_name === 'mcp__orc__report_done') m.reportDone(term(agent), e.tool_input.summary)
    m.hookEvent(term(agent), e as never)
  }
  return m.views()[0]
}

// Run 3: everything worked --------------------------------------------------
const v3 = await replay('hooks-run3-mission.json', 'smoke-003009')
const kinds = (v: typeof v3) => v.feed.map((f) => `${f.kind}:${f.from}>${f.to}${f.status ? `:${f.status}` : ''}`)
console.log('   feed:', kinds(v3).join('  '))
ok('two spawns from the coordinator', v3.feed.filter((f) => f.kind === 'spawn' && f.from === 'coordinator').length === 2)
ok('two messages sent to the coordinator', v3.feed.filter((f) => f.kind === 'message' && f.to === 'coordinator' && f.status === 'sent').length === 2)
ok('two deliveries to the coordinator, named by agent', v3.feed.filter((f) => f.kind === 'delivered' && f.to === 'coordinator' && f.from.startsWith('write-')).length === 2)
ok('two done reports', v3.feed.filter((f) => f.kind === 'done').length === 2)
ok('no steering detected in a run nobody typed into', !v3.feed.some((f) => f.kind === 'steer'))
ok('workers launched by the coordinator stay "last instruction: coordinator"', v3.agents.filter((a) => a.role === 'worker').every((a) => a.lastInstructionBy === 'coordinator'))
ok('workers done', v3.agents.filter((a) => a.role === 'worker').every((a) => a.status === 'done'))

// Run 1: SendMessage failed (inherited env) ----------------------------------
const v1 = await replay('hooks-run1-not-sent.json', 'smoke-001159')
ok('failed sends show as failed', v1.feed.filter((f) => f.kind === 'message' && f.status === 'failed').length === 2, kinds(v1).join(' '))
ok('failure text carries Claude Code\'s answer', v1.feed.some((f) => f.status === 'failed' && /not sent|reachable/i.test(f.text)))

// Steering -----------------------------------------------------------------
{
  const { m } = world()
  const id = await m.startMission({ repoPath: '/repo', name: 'steer', permissionMode: 'acceptEdits', gating: 'none' })
  await m.spawnAgent(`${id}:coordinator`, 'post-api', 'Build the post API.')
  const w = `${id}:post-api`
  m.hookEvent(w, { hook_event_name: 'UserPromptSubmit', prompt: 'Build the post API.' })
  ok('the launch task is not steering', !m.views()[0].feed.some((f) => f.kind === 'steer'))
  m.hookEvent(w, { hook_event_name: 'UserPromptSubmit', prompt: 'use snake_case for the routes' })
  const v = m.views()[0]
  ok('a human prompt in a worker is steering', v.feed.some((f) => f.kind === 'steer' && f.to === 'post-api'))
  ok('…and marks "last instruction: you"', v.agents.find((a) => a.name === 'post-api')?.lastInstructionBy === 'you')
  const stop = m.hookEvent(`${id}:coordinator`, { hook_event_name: 'Stop' })
  ok('Stop never carries notes', stop === null)
  const out = m.hookEvent(`${id}:coordinator`, { hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_input: { to: 'steer/post-api' } })
  const ctx = out ? JSON.parse(out).hookSpecificOutput : null
  ok('the coordinator\'s next PreToolUse carries the note', ctx?.hookEventName === 'PreToolUse' && /snake_case/.test(ctx?.additionalContext ?? ''), out ?? 'null')
  ok('…once', m.hookEvent(`${id}:coordinator`, { hook_event_name: 'PreToolUse', tool_name: 'Read' }) === null)
  m.hookEvent(w, { hook_event_name: 'UserPromptSubmit', prompt: '<cross-session-message from="uds:x" from-name="steer/coordinator" from-mode="prompting">\nplease add tests\n</cross-session-message>' })
  ok('a coordinator message is not steering', m.views()[0].feed.filter((f) => f.kind === 'steer').length === 1)
  ok('…and sets "last instruction: coordinator"', m.views()[0].agents.find((a) => a.name === 'post-api')?.lastInstructionBy === 'coordinator')

  // Names and stopping
  let threw = ''
  try { await m.startMission({ repoPath: '/other-repo', name: 'Steer', permissionMode: 'acceptEdits' }) } catch (e) { threw = String(e) }
  ok('a mission name is unique across spaces', /already exists/.test(threw), threw)
  m.stopMission(id)
  const s = m.views()[0]
  ok('stop: mission stopped, live agents exited', s.state === 'stopped' && s.agents.every((a) => a.status === 'exited'))
  ok('stop: no new workers', /stopped/.test(await m.spawnAgent(`${id}:coordinator`, 'late', 'x')))
}
{
  const { m, branches } = world()
  branches.add('orc/old-run/worker')
  let threw = ''
  try { await m.startMission({ repoPath: '/repo', name: 'old run', permissionMode: 'acceptEdits' }) } catch (e) { threw = String(e) }
  ok('a name whose branches exist from an earlier run is refused', /ran in this repository before/.test(threw), threw)
}

console.log(failed ? `FAIL ${failed}` : 'PASS')
process.exit(failed ? 1 : 0)
