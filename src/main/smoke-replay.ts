import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { MissionView } from '../shared/types.ts'
import type { Missions } from './missions.ts'

/** What the replay needs from the smoke harness. */
export interface ReplayCtx {
  js: <T>(code: string) => Promise<T>
  shot: (label: string) => Promise<void>
  check: (name: string, ok: boolean, detail?: string) => void
  log: (event: string) => void
  sleep: (ms: number) => Promise<void>
  missions: Missions
  sandbox: string
  transcriptFixture: string
}

/** ORC_SMOKE_SCENARIO=replay — free. Every session is a fake (`bash` printing a line), and
 *  status comes from hook events fed straight into Missions. Builds two spaces, three
 *  missions, a nested worker and every status, then clicks through the UI and asserts. */
export async function runReplay(c: ReplayCtx): Promise<void> {
  const { js, shot, check, log, sleep, missions } = c
  missions.launcher = (args) => {
    const name = args[args.indexOf('--name') + 1]
    return { command: 'bash', args: ['-c', `printf '\\033[1mfake session\\033[0m %s\\r\\n(ORC replay: no Claude here)\\r\\n' "${name}"; exec sleep 3600`] }
  }

  // A second space: a throwaway repo inside the sandbox's own excluded .orc folder.
  const spaceB = join(c.sandbox, '.orc', 'space-b')
  if (!existsSync(join(spaceB, '.git'))) {
    mkdirSync(spaceB, { recursive: true })
    execFileSync('git', ['init', '-q', '-b', 'main', spaceB])
    execFileSync('git', ['-C', spaceB, '-c', 'user.name=orc', '-c', 'user.email=orc@localhost', 'commit', '-q', '--allow-empty', '-m', 'space b'])
  }
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '')
  const start = (repoPath: string, name: string): Promise<string> =>
    js<string>(`window.orc.startMission(${JSON.stringify({ repoPath, name, permissionMode: 'acceptEdits' })})`)
  const m1 = await start(c.sandbox, `smoke-r-ui-${stamp}`)
  const m2 = await start(c.sandbox, `smoke-r-feed-${stamp}`)
  const m3 = await start(spaceB, `smoke-r-b-${stamp}`)
  log('three missions started in two spaces')

  const view = (id: string): MissionView => missions.views().find((m) => m.id === id)!
  const t = (mid: string, agent: string): string => `${mid}:${agent}`
  const hook = (mid: string, agent: string, e: Record<string, unknown>): void => {
    missions.hookEvent(t(mid, agent), { transcript_path: c.transcriptFixture, ...e } as never)
  }
  const sessionName = (mid: string, agent: string): string => view(mid).agents.find((a) => a.name === agent)!.sessionName

  // Mission 1: coordinator → navbar, post-api; post-api → tests (a sub-worker).
  for (const a of ['coordinator']) hook(m1, a, { hook_event_name: 'SessionStart' })
  hook(m1, 'coordinator', { hook_event_name: 'UserPromptSubmit', prompt: 'build the social feed' })
  await missions.spawnAgent(t(m1, 'coordinator'), 'navbar', 'Build the navbar in src/nav.')
  await missions.spawnAgent(t(m1, 'coordinator'), 'post-api', 'Build the post API in src/api.')
  await missions.spawnAgent(t(m1, 'post-api'), 'tests', 'Write tests for the post API.')
  hook(m1, 'coordinator', { hook_event_name: 'Stop' })
  for (const a of ['navbar', 'post-api', 'tests']) {
    hook(m1, a, { hook_event_name: 'SessionStart' })
    hook(m1, a, { hook_event_name: 'UserPromptSubmit', prompt: view(m1).agents.find((x) => x.name === a)!.task })
  }
  hook(m1, 'navbar', { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/x/src/nav/Navbar.tsx' } })
  hook(m1, 'post-api', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } })
  hook(m1, 'post-api', { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission' })
  missions.reportDone(t(m1, 'tests'), 'Added 6 tests for posts, likes and follows; all pass.')
  hook(m1, 'tests', { hook_event_name: 'PostToolUse', tool_name: 'SendMessage', tool_input: { to: sessionName(m1, 'post-api'), summary: 'tests written, 6 passing' }, tool_response: { success: true, message: 'sent' } })
  hook(m1, 'post-api', { hook_event_name: 'UserPromptSubmit', prompt: `<cross-session-message from="uds:x" from-name="${sessionName(m1, 'tests')}" from-mode="prompting">\ntests written, 6 passing\n</cross-session-message>` })
  hook(m1, 'post-api', { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission' })
  hook(m1, 'navbar', { hook_event_name: 'PostToolUse', tool_name: 'SendMessage', tool_input: { to: sessionName(m1, 'coordinator'), summary: 'navbar half done' }, tool_response: { success: false, message: "Not sent — no agent named 'x' is reachable." } })
  hook(m1, 'navbar', { hook_event_name: 'UserPromptSubmit', prompt: 'use the brand colours from tokens.css' })
  hook(m1, 'navbar', { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/x/src/nav/Navbar.tsx' } })
  missions.askHuman(t(m1, 'coordinator'), 'Should follows be public or private by default?')

  // Mission 2: one worker, idle. Mission 3 (space b): coordinator only.
  hook(m2, 'coordinator', { hook_event_name: 'SessionStart' })
  hook(m3, 'coordinator', { hook_event_name: 'SessionStart' })
  hook(m3, 'coordinator', { hook_event_name: 'UserPromptSubmit', prompt: 'hello' })
  await missions.refreshTokens()
  await sleep(800)

  // Select mission 1 in the UI.
  await js(`document.querySelector('[data-testid=mission][data-mission=${JSON.stringify(view(m1).name)}] button')?.click()`)
  await sleep(1200)
  await shot('replay-mission-1')

  const count = (sel: string): Promise<number> => js<number>(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
  check('two spaces listed', (await count('[data-testid=space]')) === 2, String(await count('[data-testid=space]')))
  check('three missions listed', (await count('[data-testid=mission]')) === 3)
  check('mission 1 shows four cards', (await count('[data-testid=agent-card]')) === 4)
  check('mission 1 tree has four nodes', (await count('[data-testid=tree-node]')) === 4)
  const statusOf = (agent: string): Promise<string> =>
    js<string>(`document.querySelector('[data-testid=tree-node][data-agent=${JSON.stringify(agent)}]')?.dataset.status ?? ''`)
  const want: Record<string, string> = { coordinator: 'needs-you', navbar: 'working', 'post-api': 'needs-you', tests: 'done' }
  for (const [a, s] of Object.entries(want)) check(`tree node ${a} is ${s}`, (await statusOf(a)) === s, await statusOf(a))
  const edges = await count('.react-flow__edge')
  check('tree edges: 3 spawn edges + message edges', edges >= 4, String(edges))
  const sub = await js<{ p: number; c: number }>(`(() => {
    const y = (a) => document.querySelector('.react-flow__node[data-id=' + JSON.stringify(a) + ']')?.getBoundingClientRect().top ?? -1;
    return { p: y('post-api'), c: y('tests') } })()`)
  check('the sub-worker sits below its parent', sub.c > sub.p && sub.p > 0, JSON.stringify(sub))
  const kinds = await js<string[]>(`[...document.querySelectorAll('[data-testid=feed-entry]')].map(e => e.dataset.kind + (e.dataset.status ? ':' + e.dataset.status : ''))`)
  for (const k of ['spawn', 'message:sent', 'message:failed', 'delivered', 'done', 'question', 'steer']) {
    check(`feed shows ${k}`, kinds.includes(k), kinds.join(' '))
  }
  const tokensText = await js<string>(`document.querySelector('[data-testid=header]')?.textContent ?? ''`)
  check('header shows mission tokens', /\d+(\.\d)?k tokens/.test(tokensText), tokensText.slice(0, 160))
  const cardTokens = await js<string>(`document.querySelector('[data-testid=agent-card][data-agent=navbar]')?.textContent ?? ''`)
  check('cards show tokens', /k tok/.test(cardTokens), cardTokens)
  const navbarLast = await js<string>(`document.querySelector('[data-testid=agent-card][data-agent=navbar] [data-testid=last-instruction]')?.textContent ?? ''`)
  check('steered worker says "last instruction: you"', navbarLast.includes('you'), navbarLast)

  // Click a tree node: the terminal switches.
  await js(`document.querySelector('[data-testid=tree-node][data-agent=tests]')?.click()`)
  await sleep(1000)
  const head = await js<string>(`document.querySelector('[data-testid=terminal-head]')?.dataset.agent ?? ''`)
  check('clicking the sub-worker tree node shows its terminal', head === 'tests', head)
  const term = await js<string>(`document.querySelector('[data-testid=terminal] .xterm-rows')?.textContent ?? ''`)
  check('its terminal shows its own session', term.includes('fake session') && term.includes('tests'), term.slice(0, 80))
  await shot('replay-subworker-selected')

  // Messages toggle hides the message edges.
  await js(`document.querySelector('[data-testid=toggle-messages]')?.click()`)
  await sleep(500)
  check('message toggle off leaves only spawn edges', (await count('.react-flow__edge')) === 3, String(await count('.react-flow__edge')))
  await js(`document.querySelector('[data-testid=toggle-messages]')?.click()`)

  // Space b's mission, then stop mission 2 through its button.
  await js(`document.querySelector('[data-testid=mission][data-mission=${JSON.stringify(view(m3).name)}] button')?.click()`)
  await sleep(800)
  const headerB = await js<string>(`document.querySelector('[data-testid=header-mission]')?.textContent ?? ''`)
  check('selecting the space-b mission switches the header', headerB.includes('space-b'), headerB)
  await js(`document.querySelector('[data-testid=mission][data-mission=${JSON.stringify(view(m2).name)}] button')?.click()`)
  await sleep(600)
  await js(`document.querySelector('[data-testid=stop-mission]')?.click()`)
  await sleep(1000)
  check('Stop ends the mission', view(m2).state === 'stopped' && view(m2).agents.every((a) => a.status === 'exited'))
  await shot('replay-stopped')

  // A duplicate mission name is refused with a visible error.
  await js(`document.querySelector('[data-testid=space][data-space=orc-sandbox] [data-testid=new-mission]')?.click()`)
  await sleep(400)
  await js(`(() => {
    const input = document.querySelector('[data-testid=new-mission-form] input');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(input, ${JSON.stringify(view(m1).name)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await sleep(200)
  await js(`document.querySelector('[data-testid=new-mission-form] button[type=submit]')?.click()`)
  await sleep(800)
  const err = await js<string>(`document.querySelector('[data-testid=new-mission-error]')?.textContent ?? ''`)
  check('starting a duplicate mission name shows an error', /already exists/.test(err), err)
  await shot('replay-duplicate-name')
}
