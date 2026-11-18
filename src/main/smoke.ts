import { execFile } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { BrowserWindow } from 'electron'
import type { MissionView } from '../shared/types'
import type { Missions } from './missions'
import type { TerminalHost } from './terminals'

const run = promisify(execFile)
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Only this folder's trust prompts may be answered automatically, and only by this test. */
const Sandbox = join(homedir(), 'Documents', 'Projects', 'orc-sandbox')

// eslint-disable-next-line no-control-regex
const Ansi = /\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b[()][0-9A-B]|\x1b[=>78]/g
export const stripAnsi = (s: string): string => s.replace(Ansi, ' ').replace(/[^\S\n]+/g, ' ')
const squash = (s: string): string => s.replace(Ansi, '').replace(/\s+/g, '')

export interface SmokeDeps {
  win: BrowserWindow
  missions: Missions
  terminals: TerminalHost
  userData: string
  shutdown: () => void
}

interface Check {
  name: string
  ok: boolean
  detail?: string
}

function inSandbox(cwd: string): boolean {
  try {
    const real = realpathSync(cwd)
    return real === Sandbox || real.startsWith(Sandbox + '/')
  } catch {
    return false
  }
}

/** Hidden smoke mode. Never shows the window.
 *  - ORC_SMOKE_OUT=<dir>: load the UI, write a screenshot and console errors, quit.
 *  - + ORC_SMOKE_REPO=<repo>: also start a mission there (unprompted, not billed).
 *  - + ORC_SMOKE_PROMPT="<text>": end-to-end. Types the prompt into the coordinator, answers
 *    workspace-trust prompts for orc-sandbox only, waits for workers to report done, clicks a
 *    worker card and presses Enter in its terminal, then checks the result. Billed: sessions
 *    run on ORC_SMOKE_MODEL (default haiku). Hard deadline ORC_SMOKE_TIMEOUT_S (default 480). */
export async function runSmoke(dir: string, d: SmokeDeps): Promise<boolean> {
  mkdirSync(dir, { recursive: true })
  const startedAt = Date.now()
  const errors: string[] = []
  const timeline: { t: number; event: string }[] = []
  const checks: Check[] = []
  const log = (event: string): void => {
    timeline.push({ t: Math.round((Date.now() - startedAt) / 1000), event })
  }
  const check = (name: string, ok: boolean, detail?: string): void => {
    checks.push({ name, ok, detail })
    log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
  }
  const js = <T>(code: string): Promise<T> => d.win.webContents.executeJavaScript(code) as Promise<T>
  let shots = 0
  const shot = async (label: string): Promise<void> => {
    const file = `screenshot-${String(++shots).padStart(2, '0')}-${label}.png`
    writeFileSync(join(dir, file), (await d.win.webContents.capturePage()).toPNG())
    log(`screenshot ${file}`)
  }

  d.win.webContents.on('console-message', (e) => {
    if (e.level === 'error') errors.push(e.message)
  })
  await new Promise<void>((r) => d.win.webContents.once('did-finish-load', () => r()))
  await sleep(1500)
  const rootChildren = await js<number>("document.getElementById('root')?.childElementCount ?? -1")
  check('UI rendered', rootChildren > 0, `root children ${rootChildren}`)

  const repo = process.env.ORC_SMOKE_REPO
  const prompt = process.env.ORC_SMOKE_PROMPT
  const deadline = startedAt + Number(process.env.ORC_SMOKE_TIMEOUT_S ?? 480) * 1000
  let missionId: string | null = null
  let timedOut = false

  const view = (): MissionView | undefined => d.missions.views().find((m) => m.id === missionId)

  // Trust prompts: answer "Yes, I trust this folder" (the second option; "No, exit" is
  // highlighted by default) once per terminal, only for terminals inside the sandbox.
  const trustAnswered = new Set<string>()
  const pending = new Map<string, string>()
  const untap = d.terminals.tap((id, data) => {
    if (!prompt || trustAnswered.has(id)) return
    const buf = (pending.get(id) ?? '') + squash(data)
    pending.set(id, buf.slice(-4000))
    if (!buf.includes('Yes,Itrustthisfolder')) return
    const agent = view()?.agents.find((a) => a.terminalId === id)
    if (!agent || !inSandbox(agent.cwd)) {
      log(`trust prompt in ${id} NOT answered (outside sandbox: ${agent?.cwd})`)
      trustAnswered.add(id)
      return
    }
    trustAnswered.add(id)
    log(`trust prompt in ${agent.name} (${agent.cwd}): answering Yes`)
    setTimeout(() => d.terminals.write(id, '\x1b[B'), 300)
    setTimeout(() => d.terminals.write(id, '\r'), 900)
  })

  const statusSeen = new Map<string, string>()
  const recordStates = (): void => {
    for (const a of view()?.agents ?? []) {
      const s = `${a.status} | ${a.activity}`
      if (statusSeen.get(a.name) !== s) {
        statusSeen.set(a.name, s)
        log(`${a.name}: ${s}`)
      }
    }
  }

  async function waitFor(what: string, cond: () => boolean, quietMs = 0, capMs = Infinity): Promise<boolean> {
    const until = Math.min(deadline, Date.now() + capMs)
    while (Date.now() < until) {
      recordStates()
      if (cond()) {
        if (quietMs) await sleep(quietMs)
        return true
      }
      await sleep(1000)
    }
    log(`timed out waiting for: ${what}`)
    if (Date.now() >= deadline) timedOut = true
    return false
  }

  try {
    if (repo) {
      const name = prompt ? `smoke-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}` : 'smoke'
      missionId = await d.missions.startMission({
        repoPath: repo,
        name,
        permissionMode: 'acceptEdits',
        model: prompt ? (process.env.ORC_SMOKE_MODEL ?? 'haiku') : undefined
      })
      log(`mission ${name} started`)
      const coordId = `${missionId}:coordinator`
      await js(`[...document.querySelectorAll('.card')].find(c => c.textContent.includes('coordinator'))?.click()`)

      if (!prompt) {
        await sleep(12000)
      } else {
        d.missions.maxAgentsPerMission = 4
        const coord = (): MissionView['agents'][number] | undefined =>
          view()?.agents.find((a) => a.role === 'coordinator')
        const ready = await waitFor('coordinator SessionStart', () => coord()?.status === 'idle', 2500, 90_000)
        check('coordinator started (SessionStart hook)', ready)
        await shot('coordinator-ready')
        if (ready) {
          d.terminals.write(coordId, prompt)
          await sleep(700)
          d.terminals.write(coordId, '\r')
          log('prompt typed into coordinator')
          const workers = (): MissionView['agents'] => view()?.agents.filter((a) => a.role === 'worker') ?? []
          await waitFor('two workers', () => workers().length >= 2, 0, 240_000)
          await shot('workers-spawned')
          await waitFor(
            'all workers done',
            () => workers().length >= 2 && workers().every((w) => w.status === 'done' || w.status === 'exited'),
            0
          )
          // Let the coordinator read the reports and finish its turn.
          await waitFor('coordinator idle after reports', () => coord()?.status === 'idle', 5000, 120_000)

          // UI: click a worker card, press Enter in its terminal, expect "last instruction: you".
          const w = workers()[0]
          if (w) {
            await js(`[...document.querySelectorAll('.card')].find(c => c.querySelector('strong')?.textContent === ${JSON.stringify(w.name)})?.click()`)
            await sleep(1500)
            const head = await js<string>(`document.querySelector('.center-head')?.textContent ?? ''`)
            check('clicking a worker card shows its terminal', head.includes(w.sessionName), head)
            await js(`(() => {
              const ta = document.querySelector('.xterm-helper-textarea');
              ta.focus();
              ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
            })()`)
            await sleep(1500)
            const after = d.missions.views().find((m) => m.id === missionId)?.agents.find((a) => a.name === w.name)
            check('Enter typed in worker terminal marks "last instruction: you"', after?.lastInstructionBy === 'you')
            const cardText = await js<string>(`[...document.querySelectorAll('.card')].find(c => c.querySelector('strong')?.textContent === ${JSON.stringify(w.name)})?.textContent ?? ''`)
            check('worker card shows "last instruction: you"', cardText.includes('last instruction: you'), cardText)
            await shot('worker-selected')
          }
          await js(`[...document.querySelectorAll('.card')].find(c => c.querySelector('strong')?.textContent === 'coordinator')?.click()`)
          await sleep(1500)
          await shot('coordinator-final')
        }
      }
    }
  } catch (err) {
    log(`error: ${String((err as Error)?.stack ?? err)}`)
    check('no exception', false, String(err))
  }
  untap()
  recordStates()
  if (!prompt) await shot('final')

  // Evidence, pass or fail.
  const m = view()
  const termDir = join(dir, 'terminals')
  mkdirSync(termDir, { recursive: true })
  for (const a of m?.agents ?? []) {
    const raw = d.terminals.replay(a.terminalId)
    writeFileSync(join(termDir, `${a.name}.raw.txt`), raw)
    writeFileSync(join(termDir, `${a.name}.txt`), stripAnsi(raw))
  }
  if (repo && !prompt && m) writeFileSync(join(dir, 'coordinator.txt'), d.terminals.replay(`${m.id}:coordinator`))
  const sessionIds = new Set(m?.agents.map((a) => a.sessionId) ?? [])
  const hooksFile = join(d.userData, 'hooks.jsonl')
  const hooks = existsSync(hooksFile)
    ? readFileSync(hooksFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>)
        .filter((h) => (h.at as number) >= startedAt && sessionIds.has(h.session_id as string))
    : []
  writeFileSync(join(dir, 'hooks.json'), JSON.stringify(hooks, null, 2))
  let agentsJson = ''
  try {
    agentsJson = (await run('claude', ['agents', '--json'], { timeout: 20_000 })).stdout
  } catch (err) {
    agentsJson = `error: ${String(err)}`
  }
  writeFileSync(join(dir, 'claude-agents.json'), agentsJson)

  if (prompt && m) {
    const workers = m.agents.filter((a) => a.role === 'worker')
    check('at least two workers spawned', workers.length >= 2, workers.map((w) => w.name).join(', '))
    check('every worker ran in its own worktree', workers.every((w) => w.cwd.includes('/.orc/worktrees/')) && new Set(workers.map((w) => w.cwd)).size === workers.length)
    check('every worker reported done', workers.length > 0 && workers.every((w) => w.status === 'done'), workers.map((w) => `${w.name}=${w.status}`).join(', '))
    const files = workers.flatMap((w) => ['a.txt', 'b.txt'].filter((f) => existsSync(join(w.cwd, f))).map((f) => `${w.name}/${f}`))
    check('a.txt and b.txt exist in worker worktrees', ['a.txt', 'b.txt'].every((f) => files.some((x) => x.endsWith(f))), files.join(', '))
    check('a.txt and b.txt are not in the repo root', !['a.txt', 'b.txt'].some((f) => existsSync(join(m.repoPath, f))))
    const by = (sid: string, ev: string): unknown[] => hooks.filter((h) => h.session_id === sid && h.hook_event_name === ev)
    for (const w of workers) {
      check(`${w.name}: hooks fired (SessionStart, PreToolUse, Stop)`, ['SessionStart', 'PreToolUse', 'Stop'].every((e) => by(w.sessionId, e).length > 0))
      check(`${w.name}: model flag`, true, m.model ?? 'default')
    }
    const sends = hooks.filter((h) => h.hook_event_name === 'PreToolUse' && h.tool_name === 'SendMessage' && h.agent !== `${m.id}:coordinator`)
    check('workers sent SendMessage reports', sends.length >= workers.length, `${sends.length} SendMessage calls from workers`)
    const coord = m.agents.find((a) => a.role === 'coordinator')!
    const firstDone = hooks.find((h) => h.hook_event_name === 'PreToolUse' && h.tool_name === 'mcp__orc__report_done')
    const coordAfter = hooks.filter((h) => h.session_id === coord.sessionId && (h.at as number) > ((firstDone?.at as number) ?? Infinity))
    check('coordinator was active after the first report (woken by a message)', coordAfter.length > 0, `${coordAfter.length} coordinator hook events after first report_done`)
    check('coordinator used spawn_agent', hooks.some((h) => h.session_id === coord.sessionId && h.tool_name === 'mcp__orc__spawn_agent'))
    check('no timeout', !timedOut)
  }
  check('no console errors', errors.length === 0, errors.join(' | '))

  const pids = d.terminals.pids()
  const ok = checks.every((c) => c.ok)
  const report = { ok, checks, timeline, errors, pids, missions: d.missions.views() }
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2))

  d.shutdown()
  // SIGHUP first (pty kill), then SIGKILL anything that survived.
  await sleep(3000)
  const survivors = Object.values(pids).filter((pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  })
  for (const pid of survivors) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {}
  }
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ ...report, survivorsKilled: survivors }, null, 2))
  console.log(`SMOKE ${ok ? 'PASS' : 'FAIL'} → ${dir}`)
  for (const c of checks) console.log(`${c.ok ? '  ok ' : '  FAIL'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`)
  return ok
}
