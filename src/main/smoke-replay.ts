import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MissionView } from '../shared/types.ts'
import type { Missions } from './missions.ts'
import { bashPath } from './mission-git.ts'

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
/** A fake `claude`: prints its session name (and whether it was resumed), then sleeps. */
export function fakeLauncher(args: string[]): { command: string; args: string[] } {
  const name = args[args.indexOf('--name') + 1]
  const how = args.includes('--resume') ? 'resumed' : 'started'
  return { command: bashPath(), args: ['-c', `printf '\\033[1mfake session\\033[0m %s (${how})\\r\\n(ORC replay: no Claude here)\\r\\n' "${name}"; exec sleep 3600`] }
}

export async function runReplay(c: ReplayCtx): Promise<void> {
  const { js, shot, check, log, sleep, missions } = c
  missions.launcher = fakeLauncher

  // A second space: a throwaway repo inside the sandbox's own excluded .orc folder.
  const spaceB = join(c.sandbox, '.orc', 'space-b')
  if (!existsSync(join(spaceB, '.git'))) {
    mkdirSync(spaceB, { recursive: true })
    execFileSync('git', ['init', '-q', '-b', 'main', spaceB])
    execFileSync('git', ['-C', spaceB, '-c', 'user.name=orc', '-c', 'user.email=orc@localhost', 'commit', '-q', '--allow-empty', '-m', 'space b'])
  }
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '')
  const start = (repoPath: string, name: string, gating = 'plan'): Promise<string> =>
    js<string>(`window.orc.startMission(${JSON.stringify({ repoPath, name, permissionMode: 'acceptEdits', gating })})`)
  missions.verify = async () => ({ ok: true, report: 'VERDICT: PASS\nMATCHES THE BRIEF: the doc was added.\nPROBLEMS: none\nOUTSIDE THE BRIEF: none', promptHash: 'f'.repeat(64) })
  const m1 = await start(c.sandbox, `smoke-r-ui-${stamp}`)
  const m2 = await start(c.sandbox, `smoke-r-feed-${stamp}`)
  const m3 = await start(spaceB, `smoke-r-b-${stamp}`, 'none')
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
  // Plan check: spawning is refused until the human approves the split in the UI.
  check('plan check refuses spawn before a split', /propose_split/.test(await missions.spawnAgent(t(m1, 'coordinator'), 'navbar', 'x')))
  missions.proposeSplit(t(m1, 'coordinator'), 'navbar and post API in parallel', [
    { name: 'navbar', task: 'Build the navbar in src/nav.' },
    { name: 'post-api', task: 'Build the post API in src/api.' }
  ])
  hook(m1, 'coordinator', { hook_event_name: 'Stop' })
  await js(`document.querySelector('[data-testid=mission][data-mission=${JSON.stringify(view(m1).name)}] button')?.click()`)
  await sleep(900)
  check('the split panel shows the proposal', (await js<number>(`document.querySelectorAll('[data-testid=split-panel] li').length`)) === 2)
  await shot('replay-split-proposed')
  await js(`document.querySelector('[data-testid=approve-split]')?.click()`)
  await sleep(700)
  check('Approve in the UI approves the split', view(m1).split?.status === 'approved')
  hook(m1, 'coordinator', { hook_event_name: 'UserPromptSubmit', prompt: '[The ORC] The human approved your split. Spawn the workers now with spawn_agent.' })
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
  hook(m3, 'coordinator', { hook_event_name: 'UserPromptSubmit', prompt: 'add a doc file' })
  // Space b, no check: a worker's change is committed by the app and merged on report_done.
  await js(`window.orc.setGateCommand(${JSON.stringify(spaceB)}, 'test -f doc.txt')`)
  await missions.spawnAgent(t(m3, 'coordinator'), 'doc', 'Write doc.txt')
  const docCwd = view(m3).agents.find((a) => a.name === 'doc')!.cwd
  writeFileSync(join(docCwd, 'doc.txt'), `replay ${stamp}\n`)
  missions.reportDone(t(m3, 'doc'), 'Wrote doc.txt')
  await missions.gitWork
  check('the app committed and merged the worker', view(m3).merged.join() === 'doc' && view(m3).agents.find((a) => a.name === 'doc')?.merge === 'merged')
  check('the gate ran after the merge', view(m3).gate?.ok === true, JSON.stringify(view(m3).gate))
  await missions.refreshTokens()
  await sleep(800)

  // Select mission 1 in the UI.
  await js(`document.querySelector('[data-testid=mission][data-mission=${JSON.stringify(view(m1).name)}] button')?.click()`)
  await sleep(1200)
  await shot('replay-mission-1')

  const count = (sel: string): Promise<number> => js<number>(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
  // A busy mission: a burst of hook events while its tree is on screen. The nodes must stay
  // measured and visible (React Flow hides unmeasured nodes; a blank tree was seen).
  for (let i = 0; i < 30; i++) {
    hook(m1, 'navbar', { hook_event_name: i % 2 ? 'PostToolUse' : 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: `/x/src/nav/f${i}.tsx` } })
    await sleep(12)
  }
  await sleep(1500)
  const visible = await js<{ vis: number; inside: number }>(`(() => {
    const panel = document.querySelector('[data-testid=tree]').getBoundingClientRect();
    const nodes = [...document.querySelectorAll('.react-flow__node')];
    const vis = nodes.filter((n) => getComputedStyle(n).visibility === 'visible').length;
    const inside = nodes.filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.left >= panel.left - 1 && r.right <= panel.right + 1 && r.top >= panel.top - 1 && r.bottom <= panel.bottom + 1 }).length;
    return { vis, inside } })()`)
  check('after a burst of updates every tree node is visible and inside the panel', visible.vis === 4 && visible.inside === 4, JSON.stringify(visible))
  check('two spaces listed', (await count('[data-testid=space]')) === 2, String(await count('[data-testid=space]')))
  check('three missions listed', (await count('[data-testid=mission]')) === 3)
  check('mission 1 shows four cards', (await count('[data-testid=agent-card]')) === 4)
  check('mission 1 tree has four nodes', (await count('[data-testid=tree-node]')) === 4)
  const statusOf = (agent: string): Promise<string> =>
    js<string>(`document.querySelector('[data-testid=tree-node][data-agent=${JSON.stringify(agent)}]')?.dataset.status ?? ''`)
  const want: Record<string, string> = { coordinator: 'needs-you', navbar: 'working', 'post-api': 'needs-you', tests: 'done' }
  for (const [a, s] of Object.entries(want)) check(`tree node ${a} is ${s}`, (await statusOf(a)) === s, await statusOf(a))
  // React Flow draws edges only after it has measured the nodes: poll, don't read once.
  const settle = async (sel: string, want: (n: number) => boolean): Promise<number> => {
    let n = 0
    for (let i = 0; i < 30; i++) {
      n = await count(sel)
      if (want(n)) break
      await sleep(100)
    }
    return n
  }
  const edges = await settle('.react-flow__edge', (n) => n >= 4)
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
  const spawnEdges = await settle('.react-flow__edge', (n) => n === 3)
  check('message toggle off leaves only spawn edges', spawnEdges === 3, String(spawnEdges))
  await js(`document.querySelector('[data-testid=toggle-messages]')?.click()`)

  // Space b's mission, then stop mission 2 through its button.
  await js(`document.querySelector('[data-testid=mission][data-mission=${JSON.stringify(view(m3).name)}] button')?.click()`)
  await sleep(800)
  const headerB = await js<string>(`document.querySelector('[data-testid=header-mission]')?.textContent ?? ''`)
  check('selecting the space-b mission switches the header', headerB.includes('space-b'), headerB)
  // Merge to main screen: diff, gate, Verifier, then the button.
  await js(`document.querySelector('[data-testid=open-merge]')?.click()`)
  await sleep(900)
  check('the merge screen shows the combined diff', (await js<string>(`[...document.querySelectorAll('[data-testid=diff-file]')].map(e => e.textContent).join()`)).includes('doc.txt'))
  check('the merge screen shows the gate result', /passed/.test(await js<string>(`document.querySelector('[data-testid=gate-result]')?.textContent ?? ''`)))
  await js(`document.querySelector('[data-testid=run-verifier]')?.click()`)
  await sleep(900)
  check('the Verifier verdict shows', /PASS/.test(await js<string>(`document.querySelector('[data-testid=verifier-status]')?.textContent ?? ''`)))
  await shot('replay-merge-screen')
  await js(`document.querySelector('[data-testid=confirm-merge]')?.click()`)
  await sleep(1500)
  const mergeMsg = await js<string>(`document.querySelector('[data-testid=merge-result]')?.textContent ?? ''`)
  check('Merge to main fast-forwards space-b main', /Merged/.test(mergeMsg) && existsSync(join(spaceB, 'doc.txt')), mergeMsg)
  check('…and the mission is finished', !!view(m3).mergedToMain && view(m3).state === 'stopped')
  await js(`document.querySelector('[data-testid=mission][data-mission=${JSON.stringify(view(m2).name)}] button')?.click()`)
  await sleep(600)
  await js(`document.querySelector('[data-testid=stop-mission]')?.click()`)
  await sleep(1000)
  check('Stop ends the mission', view(m2).state === 'stopped' && view(m2).agents.every((a) => a.status === 'exited'))
  await shot('replay-stopped')

  // A failed action that nothing awaits still surfaces (the banner), and the UI survives it.
  await js(`void window.orc.addSpace('/tmp')`)
  await sleep(600)
  const banner = await js<string>(`document.querySelector('[data-testid=action-error]')?.textContent ?? ''`)
  check('a failed action shows a banner, not silence', /not inside a git repository/.test(banner), banner)
  check('the UI is still up after it', (await count('[data-testid=space]')) === 2 && (await count('[data-testid=ui-error]')) === 0)
  await js(`document.querySelector('[data-testid=action-error] button')?.click()`)
  await sleep(200)

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
