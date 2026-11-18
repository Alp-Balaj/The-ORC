import { execFile } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, realpathSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, sep } from 'node:path'
import { promisify } from 'node:util'
import type { BrowserWindow } from 'electron'
import type { MissionView } from '../shared/types.ts'
import { readAgentStates } from './agent-status.ts'
import { runReplay } from './smoke-replay.ts'
import { sessionEnv } from './claude-launch.ts'
import type { Missions } from './missions.ts'
import type { TerminalHost } from './terminals.ts'

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
  appPath: string
  shutdown: () => void
  /** The real quit path (before-quit, windows closing), as Ctrl+Q would. */
  quit: () => void
}

interface Check {
  name: string
  ok: boolean
  detail?: string
}

function inSandbox(cwd: string): boolean {
  try {
    const real = realpathSync(cwd)
    return real === Sandbox || real.startsWith(Sandbox + sep)
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
    const entry = { t: Math.round((Date.now() - startedAt) / 1000), event }
    timeline.push(entry)
    // Written as it happens, so a hang still leaves a trail.
    try {
      appendFileSync(join(dir, 'timeline.log'), `${entry.t}s ${event}\n`)
    } catch {}
  }
  const check = (name: string, ok: boolean, detail?: string): void => {
    checks.push({ name, ok, detail })
    log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
  }
  const js = <T>(code: string): Promise<T> => d.win.webContents.executeJavaScript(code) as Promise<T>
  let shots = 0
  // The smoke window renders offscreen (see index.ts), so capturePage keeps working while
  // hidden. Give up after 8 s rather than hang the test.
  const shot = async (label: string): Promise<void> => {
    const file = `screenshot-${String(++shots).padStart(2, '0')}-${label}.png`
    d.win.webContents.invalidate()
    const img = await Promise.race([d.win.webContents.capturePage(), sleep(8000).then(() => null)])
    if (img) writeFileSync(join(dir, file), img.toPNG())
    log(img ? `screenshot ${file}` : `screenshot ${file} timed out`)
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
  const scenario = process.env.ORC_SMOKE_SCENARIO ?? 'mission'
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
    if (scenario === 'crash-a') {
      // Crash test, part 1: a mission with fake sessions, then wait to be SIGKILLed.
      const id = await js<string>(`window.orc.startMission(${JSON.stringify({ repoPath: Sandbox, name: `smoke-crash-${Date.now() % 100000}`, permissionMode: 'acceptEdits', gating: 'none' })})`)
      const fixture = join(d.appPath, 'tests', 'fixtures', 'transcript-worker.jsonl')
      d.missions.hookEvent(`${id}:coordinator`, { hook_event_name: 'SessionStart', transcript_path: fixture } as never)
      d.missions.hookEvent(`${id}:coordinator`, { hook_event_name: 'UserPromptSubmit', prompt: 'crash test brief' } as never)
      await d.missions.spawnAgent(`${id}:coordinator`, 'survivor', 'Write survivor.txt')
      d.missions.hookEvent(`${id}:survivor`, { hook_event_name: 'UserPromptSubmit', prompt: 'Write survivor.txt', transcript_path: fixture } as never)
      d.missions.hookEvent(`${id}:survivor`, { hook_event_name: 'PreToolUse', tool_name: 'Write' } as never)
      await sleep(1200) // > the 300 ms save debounce
      log('ready-for-crash')
      if (process.env.ORC_SMOKE_QUIT) {
        // Normal quit instead of a crash: the state must still say "running", not "exited".
        d.quit()
        await sleep(10_000)
      }
      await sleep(120_000)
    } else if (scenario === 'fresh-a') {
      // Free: a real coordinator that never gets a prompt, then a normal quit.
      const id = await js<string>(`window.orc.startMission(${JSON.stringify({ repoPath: Sandbox, name: `smoke-fresh-${Date.now() % 100000}`, permissionMode: 'acceptEdits', gating: 'none', model: 'haiku' })})`)
      missionId = id
      check('real session started', await waitFor('SessionStart', () => view()?.agents[0]?.status === 'idle', 2500, 60_000))
      await sleep(800)
      log('ready-for-crash')
      d.quit()
      await sleep(120_000)
    } else if (scenario === 'fresh-b') {
      const m = (): MissionView | undefined => d.missions.views()[0]
      missionId = m()?.id ?? null
      check('the never-prompted mission is back', m()?.state === 'running')
      const c = (): MissionView['agents'][number] | undefined => m()?.agents[0]
      // Restore sets "starting | restarted"; only a new SessionStart from this launch turns it
      // into "idle | ready" (it may already have, before this check runs).
      check('its session starts again with the same --session-id (a new SessionStart)', await waitFor('SessionStart again', () => c()?.status === 'idle' && c()?.activity === 'ready', 0, 60_000) && d.terminals.isRunning(c()!.terminalId), `${c()?.status} | ${c()?.activity}`)
      const out = stripAnsi(d.terminals.replay(c()!.terminalId))
      check('no session-id error from claude', !/already in use|invalid session|error/i.test(out.slice(0, 3000)), out.slice(0, 160))
    } else if (scenario === 'resume-a') {
      // Billed (1 Haiku session): a real turn, Pause mid-turn, Resume, then wait to be killed.
      const id = await js<string>(`window.orc.startMission(${JSON.stringify({ repoPath: Sandbox, name: `smoke-resume-${Date.now() % 100000}`, permissionMode: 'acceptEdits', gating: 'none', model: process.env.ORC_SMOKE_MODEL ?? 'haiku' })})`)
      missionId = id
      const coordId = `${id}:coordinator`
      const coord = (): MissionView['agents'][number] | undefined => view()?.agents.find((a) => a.role === 'coordinator')
      const type = async (text: string): Promise<void> => {
        d.terminals.write(coordId, text)
        await sleep(700)
        d.terminals.write(coordId, '\r')
      }
      check('real session started', await waitFor('SessionStart', () => coord()?.status === 'idle', 2500, 90_000))
      await type('Remember this codeword: PELICAN. Reply with just OK.')
      check('first turn finished', await waitFor('turn 1', () => coord()?.status === 'idle' && Date.now() - startedAt > 8000, 1500, 90_000))
      await type('Write the numbers from 1 to 400 as words, one per line, in your reply. Do not use any tools.')
      const busy = await waitFor('mid-turn', () => coord()?.status === 'working', 2500, 30_000)
      check('the agent is mid-turn', busy)
      await js(`document.querySelector('[data-testid=pause-mission]')?.click()`)
      log('pause clicked')
      const stopped = await waitFor('interrupted', () => coord()?.status === 'idle', 0, 30_000)
      check('Pause interrupts a turn in progress (Esc)', stopped, coord()?.activity)
      check('the mission shows paused', !!view()?.paused && (await js<number>(`document.querySelectorAll('[data-testid=paused-badge]').length`)) === 1)
      await shot('paused')
      await js(`document.querySelector('[data-testid=resume-mission]')?.click()`)
      await sleep(800)
      check('Resume clears it', !view()?.paused)
      await sleep(1200)
      log('ready-for-crash')
      await sleep(120_000)
    } else if (scenario === 'resume-b') {
      // Relaunched on the same state after a SIGKILL: the real session is resumed and still
      // remembers the codeword from before the crash.
      const m = (): MissionView | undefined => d.missions.views()[0]
      missionId = m()?.id ?? null
      const coord = (): MissionView['agents'][number] | undefined => m()?.agents.find((a) => a.role === 'coordinator')
      check('the mission is back', !!m())
      check('the resumed session starts', await waitFor('SessionStart after resume', () => coord()?.activity !== 'resumed after restart' || coord()?.status === 'idle', 3000, 90_000))
      const coordId = `${m()!.id}:coordinator`
      d.terminals.write(coordId, 'What was the codeword I asked you to remember? Reply with just the word.')
      await sleep(700)
      d.terminals.write(coordId, '\r')
      await waitFor('answer', () => coord()?.status === 'working', 0, 30_000)
      await waitFor('answer done', () => coord()?.status === 'idle', 2000, 90_000)
      // The evidence is the transcript's last assistant message (the screen redraws old text).
      const tp = d.missions.snapshot().missions[0]?.agents.find((a) => a.role === 'coordinator')?.transcriptPath
      let last = ''
      if (tp && existsSync(tp)) {
        for (const line of readFileSync(tp, 'utf8').split('\n')) {
          try {
            const r = JSON.parse(line) as { type?: string; message?: { content?: unknown } }
            if (r.type !== 'assistant') continue
            const c = r.message?.content
            const t = Array.isArray(c) ? c.map((x: { text?: string }) => x.text ?? '').join(' ') : String(c ?? '')
            if (t.trim()) last = t.trim()
          } catch {}
        }
      }
      check('the resumed session remembers the conversation from before the crash', /PELICAN/i.test(last), `last answer: ${last.slice(0, 80)}`)
      await shot('resumed')
    } else if (scenario === 'crash-b') {
      // Part 2, relaunched on the same state file: everything must be back.
      await sleep(2500)
      const m = d.missions.views()[0]
      check('the mission is back after a crash', !!m && m.state === 'running', m?.name)
      check('both agents are back', m?.agents.length === 2)
      check('their sessions run again', !!m && m.agents.every((a) => d.terminals.isRunning(a.terminalId)))
      const out = m ? stripAnsi(d.terminals.replay(`${m.id}:survivor`)) : ''
      check('the worker was resumed (claude --resume)', out.includes('(resumed)'), out.slice(0, 120))
      check('its cut-off turn is over: idle, not working', m?.agents.find((a) => a.name === 'survivor')?.status === 'idle')
      check('the feed says what recovery did', !!m?.feed.some((f) => f.kind === 'orc' && /resumed/.test(f.text)))
      await js(`document.querySelector('[data-testid=agent-card][data-agent=survivor]')?.click()`)
      await sleep(1000)
      check('the UI shows the recovered worker', (await js<string>(`document.querySelector('[data-testid=terminal] .xterm-rows')?.textContent ?? ''`)).includes('resumed'))
      await shot('recovered')
    } else if (scenario === 'replay') {
      await runReplay({ js, shot, check, log, sleep, missions: d.missions, sandbox: Sandbox, transcriptFixture: join(d.appPath, 'tests', 'fixtures', 'transcript-worker.jsonl') })
    } else if (repo) {
      const name = prompt ? `smoke-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}` : 'smoke'
      // Through the renderer's preload API, so the IPC path the UI uses is covered too.
      const req = {
        repoPath: repo,
        name,
        permissionMode: 'acceptEdits',
        model: prompt ? (process.env.ORC_SMOKE_MODEL ?? 'haiku') : undefined,
        gating: process.env.ORC_SMOKE_GATING ?? (scenario === 'conflict' ? 'none' : 'plan')
      }
      missionId = await js<string>(`window.orc.startMission(${JSON.stringify(req)})`)
      log(`mission ${name} started via window.orc.startMission`)
      const coordId = `${missionId}:coordinator`
      await sleep(300)
      await js(`document.querySelector('[data-testid=agent-card][data-agent=coordinator]')?.click()`)

      if (!prompt) {
        for (let i = 0; i < 3; i++) {
          await sleep(4000)
          await shot(`idle-${i}`)
        }
      } else {
        d.missions.maxAgentsPerMission = 4
        const coord = (): MissionView['agents'][number] | undefined =>
          view()?.agents.find((a) => a.role === 'coordinator')
        const ready = await waitFor('coordinator SessionStart', () => coord()?.status === 'idle', 2500, 90_000)
        check('coordinator started (SessionStart hook)', ready)
        await shot('coordinator-ready')
        if (ready && scenario === 'conflict') {
          // Two real workers write the same file: the second merge conflicts, goes back to that
          // worker with the markers in place, and its retry merges.
          d.terminals.write(coordId, prompt)
          await sleep(700)
          d.terminals.write(coordId, '\r')
          const hadConflict = await waitFor('a conflict', () => !!view()?.feed.some((f) => f.kind === 'conflict'), 0, 300_000)
          check('a real conflict was detected', hadConflict)
          await shot('conflict')
          // The model decides how to resolve: it may ask the human, or hit a permission prompt.
          // Act like the human on every needs-you until both workers merge.
          const handled = new Map<string, number>()
          const until = Math.min(deadline, Date.now() + 300_000)
          while (Date.now() < until && (view()?.merged.length ?? 0) < 2) {
            recordStates()
            for (const w of view()?.agents.filter((a) => a.role === 'worker' && a.status === 'needs-you') ?? []) {
              const key = `${w.name}:${w.question ?? w.activity}`
              if ((handled.get(key) ?? 0) > Date.now() - 15_000) continue
              handled.set(key, Date.now())
              if (w.question) {
                log(`answering ${w.name}: ${w.question}`)
                d.terminals.write(w.terminalId, 'Keep both: line 1 red, line 2 blue. Edit the file only, then call report_done again.')
                await sleep(700)
              } else log(`approving ${w.name}'s permission prompt`)
              d.terminals.write(w.terminalId, '\r')
            }
            await sleep(1500)
          }
          const both = (view()?.merged.length ?? 0) >= 2
          check('the conflicted worker resolved it and both merged', both, (view()?.agents ?? []).map((a) => `${a.name}=${a.merge}`).join(', '))
          const integ = join(view()!.repoPath, '.orc', 'worktrees', view()!.name, '_integration')
          const files = existsSync(integ) ? (await run('git', ['-C', integ, 'grep', '-l', '^<<<<<<<'], {}).catch(() => ({ stdout: '' }))).stdout.trim() : 'no integration worktree'
          check('no conflict markers reached integration', files === '', files)
          const typedMidTurn = view()!.feed.filter((f) => f.kind === 'conflict').length
          log(`conflict entries: ${typedMidTurn}`)
          await shot('conflict-resolved')
        } else if (ready && scenario === 'deny') {
          // Agents never commit: a git commit must be refused by the deny rules, without a prompt.
          const before = (await run('git', ['-C', Sandbox, 'rev-parse', 'HEAD'])).stdout.trim()
          d.terminals.write(coordId, prompt)
          await sleep(700)
          d.terminals.write(coordId, '\r')
          await waitFor('turn finished', () => coord()?.status === 'idle' && (view()?.feed.length ?? 0) >= 0 && Date.now() - startedAt > 15_000, 3000, 120_000)
          const after = (await run('git', ['-C', Sandbox, 'rev-parse', 'HEAD'])).stdout.trim()
          check('git commit by an agent did not create a commit', before === after, `${before.slice(0, 8)} → ${after.slice(0, 8)}`)
          const text = stripAnsi(d.terminals.replay(coordId))
          check('Claude Code reports the command as denied', /denied|not allowed|permission/i.test(text), (/.{0,80}(denied|not allowed).{0,80}/i.exec(text)?.[0] ?? '').trim())
          check('no permission prompt was needed (deny, not ask)', coord()?.status !== 'needs-you')
        } else if (ready && scenario === 'permission') {
          // One session: ask for a shell command acceptEdits won't auto-approve, and expect
          // the Notification hook to turn the card ◐ "needs you". Then cancel with Esc.
          d.terminals.write(coordId, prompt)
          await sleep(700)
          d.terminals.write(coordId, '\r')
          log('prompt typed into coordinator')
          const asked = await waitFor('needs-you', () => coord()?.status === 'needs-you', 1500, 120_000)
          check('a pending permission prompt turns the agent needs-you', asked, coord()?.activity)
          await shot('permission-prompt')
          const cardStatus = await js<string>(`document.querySelector('[data-testid=agent-card][data-agent=coordinator]')?.dataset.status ?? ''`)
          check('the card shows needs-you', cardStatus === 'needs-you', cardStatus)
          const sid = coord()?.sessionId ?? ''
          const during = (await readAgentStates()).get(sid)
          log(`claude agents says ${during} during the permission prompt`)
          await sleep(9000)
          check('needs-you survives the status poller while the prompt is open', coord()?.status === 'needs-you', `${coord()?.status}; claude agents: ${(await readAgentStates()).get(sid)}`)
          d.terminals.write(coordId, '\x1b')
          await waitFor('idle after cancel', () => coord()?.status === 'idle', 2000, 30_000)
          check('Esc on the prompt returns the agent to idle (via the poller)', coord()?.status === 'idle', `${coord()?.status} | ${coord()?.activity}`)
        } else if (ready) {
          d.terminals.write(coordId, prompt)
          await sleep(700)
          d.terminals.write(coordId, '\r')
          log('prompt typed into coordinator')
          const workers = (): MissionView['agents'] => view()?.agents.filter((a) => a.role === 'worker') ?? []
          // Plan check (the default): wait for the split, approve it in the UI.
          const proposed = await waitFor('split proposed', () => view()?.split?.status === 'pending', 1000, 180_000)
          check('the coordinator proposed a split (plan check)', proposed, view()?.split ? `${view()!.split!.workers.length} workers` : 'none')
          await shot('split-proposed')
          await js(`document.querySelector('[data-testid=approve-split]')?.click()`)
          log('split approved in the UI')
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
            // The tree node first (the plan's core interaction), then the card.
            await js(`document.querySelector('[data-testid=tree-node][data-agent=${JSON.stringify(w.name)}]')?.click()`)
            await sleep(1200)
            const viaTree = await js<string>(`document.querySelector('[data-testid=terminal-head]')?.textContent ?? ''`)
            check('clicking a tree node shows that agent\'s terminal', viaTree.includes(w.sessionName), viaTree)
            const vis = await js<number>(`[...document.querySelectorAll('.react-flow__node')].filter((n) => getComputedStyle(n).visibility === 'visible' && n.getBoundingClientRect().width > 0).length`)
            check('every tree node is actually visible', vis === (view()?.agents.length ?? -1), `${vis} visible of ${view()?.agents.length}`)
            await js(`document.querySelector('[data-testid=agent-card][data-agent=coordinator]')?.click()`)
            await sleep(600)
            await js(`document.querySelector('[data-testid=agent-card][data-agent=${JSON.stringify(w.name)}]')?.click()`)
            await sleep(1500)
            const head = await js<string>(`document.querySelector('[data-testid=terminal-head]')?.textContent ?? ''`)
            check('clicking a worker card shows its terminal', head.includes(w.sessionName), head)
            await js(`(() => {
              const ta = document.querySelector('.xterm-helper-textarea');
              ta.focus();
              ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
            })()`)
            await sleep(1500)
            const after = d.missions.views().find((m) => m.id === missionId)?.agents.find((a) => a.name === w.name)
            check('Enter typed in worker terminal marks "last instruction: you"', after?.lastInstructionBy === 'you')
            const cardText = await js<string>(`document.querySelector('[data-testid=agent-card][data-agent=${JSON.stringify(w.name)}] [data-testid=last-instruction]')?.textContent ?? ''`)
            check('worker card shows "last instruction: you"', cardText.includes('last instruction: you'), cardText)
            await shot('worker-selected')

            // Steering (plan §6): the human types an instruction into the worker. Its
            // coordinator must be told, through a hook's additionalContext.
            const steerText = 'Also add a second line saying bye to your file, then report to your coordinator again.'
            await js(`window.orc.write(${JSON.stringify(w.terminalId)}, ${JSON.stringify(steerText)})`)
            await sleep(700)
            await js(`(() => {
              const ta = document.querySelector('.xterm-helper-textarea');
              ta.focus();
              ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
            })()`)
            log('steering instruction typed into the worker')
            const steered = await waitFor('steer in feed', () => !!view()?.feed.some((f) => f.kind === 'steer' && f.to === w.name), 0, 60_000)
            check('typing into a worker shows as steering in the feed', steered)
            await waitFor('worker done again', () => view()?.agents.find((a) => a.name === w.name)?.status === 'done', 0, 120_000)
            await waitFor('coordinator idle after the second report', () => coord()?.status === 'idle', 6000, 120_000)
            await sleep(6000) // one token refresh
            await shot('after-steering')
          }
          await js(`document.querySelector('[data-testid=agent-card][data-agent=coordinator]')?.click()`)
          await sleep(1500)
          await shot('coordinator-final')

          // M3: the app committed and merged each worker; the human merges to main.
          await waitFor('both workers merged into integration', () => (view()?.merged.length ?? 0) >= 2, 0, 60_000)
          const mv = view()!
          check('the app committed and merged both workers into integration', mv.merged.length >= 2, mv.merged.join(', '))
          check('before the merge, a.txt and b.txt are not in the repo root', !['a.txt', 'b.txt'].some((f) => existsSync(join(mv.repoPath, f))))
          await js(`document.querySelector('[data-testid=open-merge]')?.click()`)
          await sleep(1200)
          await js(`document.querySelector('[data-testid=run-verifier]')?.click()`)
          log('verifier started')
          const verified = await waitFor('verifier', () => view()?.verifier?.status === 'done' || view()?.verifier?.status === 'failed', 2000, 300_000)
          check('the Verifier produced a report', verified && view()?.verifier?.status === 'done', (view()?.verifier?.report ?? '').split('\n')[0])
          await shot('merge-screen')
          await js(`document.querySelector('[data-testid=confirm-merge]')?.click()`)
          await waitFor('merged to main', () => !!view()?.mergedToMain, 1000, 30_000)
          check('Merge to main put a.txt and b.txt on main', !!view()?.mergedToMain && ['a.txt', 'b.txt'].every((f) => existsSync(join(mv.repoPath, f))))
          await shot('merged-to-main')
        }
      }
    }
  } catch (err) {
    log(`error: ${String((err as Error)?.stack ?? err)}`)
    check('no exception', false, String(err))
  }
  untap()
  recordStates()


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
    agentsJson = (await run('claude', ['agents', '--json'], { timeout: 20_000, env: sessionEnv() })).stdout
  } catch (err) {
    agentsJson = `error: ${String(err)}`
  }
  writeFileSync(join(dir, 'claude-agents.json'), agentsJson)

  if (prompt && m && scenario === 'mission') {
    const workers = m.agents.filter((a) => a.role === 'worker')
    check('at least two workers spawned', workers.length >= 2, workers.map((w) => w.name).join(', '))
    check('every worker ran in its own worktree', workers.every((w) => w.cwd.includes('/.orc/worktrees/')) && new Set(workers.map((w) => w.cwd)).size === workers.length)
    check('every worker reported done', workers.length > 0 && workers.every((w) => w.status === 'done'), workers.map((w) => `${w.name}=${w.status}`).join(', '))
    const files = workers.flatMap((w) => ['a.txt', 'b.txt'].filter((f) => existsSync(join(w.cwd, f))).map((f) => `${w.name}/${f}`))
    check('a.txt and b.txt were written in worker worktrees (merged and removed since)', m.mergedToMain ? m.feed.filter((f) => f.kind === 'commit').length >= 2 : ['a.txt', 'b.txt'].every((f) => files.some((x) => x.endsWith(f))), files.join(', ') || 'worktrees removed after merge')
    const by = (sid: string, ev: string): unknown[] => hooks.filter((h) => h.session_id === sid && h.hook_event_name === ev)
    for (const w of workers) {
      check(`${w.name}: hooks fired (SessionStart, PreToolUse, Stop)`, ['SessionStart', 'PreToolUse', 'Stop'].every((e) => by(w.sessionId, e).length > 0))
      const banner = stripAnsi(d.terminals.replay(w.terminalId)).slice(0, 4000)
      check(`${w.name}: runs on the mission's model`, !m.model || banner.toLowerCase().includes(m.model.toLowerCase()), m.model ?? 'default')
    }
    const sends = hooks.filter((h) => h.hook_event_name === 'PreToolUse' && h.tool_name === 'SendMessage' && h.agent !== `${m.id}:coordinator`)
    const undelivered = workers.filter((w) => /Not sent/.test(stripAnsi(d.terminals.replay(w.terminalId))))
    check('no SendMessage came back "Not sent"', undelivered.length === 0, undelivered.map((w) => w.name).join(', '))
    check('workers sent SendMessage reports', sends.length >= workers.length, `${sends.length} SendMessage calls from workers`)
    const coord = m.agents.find((a) => a.role === 'coordinator')!
    const firstDone = hooks.find((h) => h.hook_event_name === 'PreToolUse' && h.tool_name === 'mcp__orc__report_done')
    const coordAfter = hooks.filter((h) => h.session_id === coord.sessionId && (h.at as number) > ((firstDone?.at as number) ?? Infinity))
    check('coordinator was active after the first report (woken by a message)', coordAfter.length > 0, `${coordAfter.length} coordinator hook events after first report_done`)
    const coordTranscript = hooks.find((h) => h.session_id === coord.sessionId && typeof h.transcript_path === 'string')?.transcript_path as string | undefined
    const transcript = coordTranscript && existsSync(coordTranscript) ? readFileSync(coordTranscript, 'utf8') : ''
    check('the coordinator was told the human steered the worker (hook additionalContext)', transcript.includes('The human typed directly to your worker'), coordTranscript ?? 'no transcript path')
    check('cards count tokens', workers.every((w) => w.tokens > 0) && m.tokens > 0, workers.map((w) => `${w.name}=${w.tokens}`).join(', ') + ` mission=${m.tokens}`)
    const feedKinds = new Set(m.feed.map((f) => f.kind))
    check('feed has spawn, message, delivered, done, steer', ['spawn', 'message', 'delivered', 'done', 'steer'].every((k) => feedKinds.has(k as never)), [...feedKinds].join(','))
    check('coordinator used spawn_agent', hooks.some((h) => h.session_id === coord.sessionId && h.tool_name === 'mcp__orc__spawn_agent'))
    check('no timeout', !timedOut)
  }
  check('no console errors', errors.length === 0, errors.join(' | '))
  // Rejected actions are shown in a banner (and kept out of the console), so check the banner.
  const banner = await js<string>(`document.querySelector('[data-testid=action-error]')?.textContent ?? ''`).catch(() => '')
  check('no failed-action banner', banner === '', banner)

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
