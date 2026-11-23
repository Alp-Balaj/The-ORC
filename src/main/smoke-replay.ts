import { clipboard } from 'electron'
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
  // Selects a mission and opens its cards. Clicking the row of the mission already open closes it.
  const missionRow = (id: string): string => `document.querySelector('[data-testid=mission][data-mission=${JSON.stringify(view(id).name)}] button')`
  const openMission = (id: string): Promise<void> => js(`(() => { const b = ${missionRow(id)}; if (b && b.getAttribute('aria-expanded') !== 'true') b.click() })()`)
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
  await openMission(m1)
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
  await openMission(m1)
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
  // Finished workers a lead folds into its "+N done" chip count too.
  const folded = await js<number>(`[...document.querySelectorAll('[data-testid=tree-chip]')].reduce((s, e) => s + (/^\\+(\\d+)/.exec(e.textContent.trim())?.[1] | 0), 0)`)
  check('mission 1 tree has four nodes (shown + folded)', (await count('[data-testid=tree-node]')) + folded === 4)
  await js(`${missionRow(m1)}?.click()`)
  await sleep(500)
  const collapsedCards = await count('[data-testid=agent-card]')
  const headerStill = await js<string>(`document.querySelector('[data-testid=header-mission]')?.textContent ?? ''`)
  check('clicking the open mission closes its cards, and it stays selected', collapsedCards === 0 && headerStill.includes(view(m1).name), `${collapsedCards} ${headerStill}`)
  await js(`${missionRow(m1)}?.click()`)
  await sleep(500)
  check('…and clicking it again opens them', (await count('[data-testid=agent-card]')) === 4)
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

  // Copy from a terminal: select, then Ctrl+C copies instead of interrupting. The owner's
  // clipboard is put back afterwards.
  const savedClipboard = clipboard.readText()
  clipboard.writeText('')
  await js(`(() => {
    const el = document.querySelector('[data-testid=terminal]');
    el.orcTerm.selectAll();
    el.querySelector('.xterm-helper-textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', keyCode: 67, ctrlKey: true, bubbles: true, cancelable: true }));
  })()`)
  await sleep(300)
  const copied = clipboard.readText()
  const cleared = await js<boolean>(`!document.querySelector('[data-testid=terminal]').orcTerm.hasSelection()`)
  clipboard.writeText(savedClipboard)
  check('Ctrl+C with text selected copies it from the terminal', copied.includes('fake session') && copied.includes('tests') && cleared, copied.slice(0, 80))
  check('…and does not interrupt the session', view(m1).agents.find((a) => a.name === 'tests')!.status !== 'exited')

  // Messages toggle hides the message edges.
  await js(`document.querySelector('[data-testid=toggle-messages]')?.click()`)
  await sleep(500)
  const spawnEdges = await settle('.react-flow__edge', (n) => n === 3)
  check('message toggle off leaves only spawn edges', spawnEdges === 3, String(spawnEdges))
  await js(`document.querySelector('[data-testid=toggle-messages]')?.click()`)

  // Space b's mission, then stop mission 2 through its button.
  await openMission(m3)
  await sleep(800)
  const headerB = await js<string>(`document.querySelector('[data-testid=header-mission]')?.textContent ?? ''`)
  check('selecting the space-b mission switches the header', headerB.includes('space-b'), headerB)
  // Merge to main screen: diff, gate, Verifier, then the button.
  await js(`document.querySelector('[data-testid=open-merge]')?.click()`)
  // The diff loads from git after the screen opens: wait for it rather than a fixed sleep.
  let diffFiles = ''
  for (const end = Date.now() + 5000; Date.now() < end && !diffFiles.includes('doc.txt'); await sleep(250)) {
    diffFiles = await js<string>(`[...document.querySelectorAll('[data-testid=diff-file]')].map(e => e.textContent).join()`)
  }
  check('the merge screen shows the combined diff', diffFiles.includes('doc.txt'), diffFiles)
  check('the merge screen shows the gate result', /passed/.test(await js<string>(`document.querySelector('[data-testid=gate-result]')?.textContent ?? ''`)))
  // Git is slow on Windows (virus scanner): wait for results instead of a fixed sleep.
  const textOf = (sel: string): Promise<string> => js<string>(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`)
  const waitText = async (sel: string, re: RegExp, ms = 10_000): Promise<string> => {
    let t = ''
    for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) if (re.test((t = await textOf(sel)))) break
    return t
  }
  await js(`document.querySelector('[data-testid=run-verifier]')?.click()`)
  check('the Verifier verdict shows', /PASS/.test(await waitText('[data-testid=verifier-status]', /PASS/)))
  await shot('replay-merge-screen')
  await js(`document.querySelector('[data-testid=confirm-merge]')?.click()`)
  // A successful merge clears the mission out, so its merge screen (and result text) goes with it.
  const m3Gone = (): boolean => !missions.views().some((v) => v.id === m3)
  for (const end = Date.now() + 10_000; Date.now() < end && !m3Gone(); await sleep(250));
  check('Merge to main fast-forwards space-b main', existsSync(join(spaceB, 'doc.txt')))
  check('…and the merged mission is cleared out', m3Gone())
  await openMission(m2)
  await sleep(600)
  await js(`document.querySelector('[data-testid=stop-mission]')?.click()`)
  await sleep(1000)
  check('Stop ends the mission', view(m2).state === 'stopped' && view(m2).agents.every((a) => a.status === 'exited'))
  await shot('replay-stopped')

  // Restart brings a mission stopped by mistake back.
  await js(`document.querySelector('[data-testid=restart-mission]')?.click()`)
  await sleep(1000)
  const coord2 = view(m2).agents.find((a) => a.name === 'coordinator')!
  check('Restart brings a stopped mission back', view(m2).state === 'running' && coord2.status !== 'exited', `${view(m2).state} ${coord2.status}`)
  check('…and the Restart button is gone', (await count('[data-testid=restart-mission]')) === 0)

  // Run app: one mission's app at a time, from its integration branch. A real server on a fixed
  // port, so an old app left running would make the next fail with EADDRINUSE.
  const appCmd = `echo "app from $(basename "$(dirname "$PWD")")"; node -e "require('http').createServer().listen(47391, () => console.log('listening on 47391'))"`
  await js(`window.orc.updateSpace(${JSON.stringify(c.sandbox)}, { runCommand: ${JSON.stringify(appCmd)} })`)
  const appState = (): Promise<{ missionId: string; status: string; terminalId: string } | null> => js(`window.orc.currentApp()`)
  const waitApp = async (mid: string): Promise<string> => {
    let out = ''
    for (const end = Date.now() + 15000; Date.now() < end; await sleep(250)) {
      const st = await appState()
      out = st ? await js<string>(`window.orc.replay(${JSON.stringify(st.terminalId)})`) : ''
      if (st?.missionId === mid && /listening on 47391|EADDRINUSE/.test(out)) break
    }
    return out
  }
  await openMission(m2)
  await sleep(400)
  await js(`document.querySelector('[data-testid=run-app]')?.click()`)
  const out2 = await waitApp(m2)
  check("Run app starts the app from the mission's integration branch", out2.includes(`app from ${view(m2).name}`) && /listening on 47391/.test(out2), out2.slice(-300))
  check('…and shows its terminal', (await count('[data-testid=app-head]')) === 1)
  await openMission(m1)
  await sleep(400)
  await js(`document.querySelector('[data-testid=run-app]')?.click()`)
  const out1 = await waitApp(m1)
  check('Run app in another mission ends the first app and gets its port', /listening on 47391/.test(out1) && !/EADDRINUSE/.test(out1) && (await appState())?.missionId === m1, out1.slice(-300))
  check('…and the mission row shows its app is running', (await count(`[data-testid=mission][data-mission=${JSON.stringify(view(m1).name)}] [data-testid=app-running-marker]`)) === 1 && (await count('[data-testid=app-running-marker]')) === 1)
  await shot('replay-app-running')
  await js(`document.querySelector('[data-testid=stop-app]')?.click()`)
  for (const end = Date.now() + 10000; Date.now() < end && (await appState())?.status !== 'exited'; await sleep(250));
  check('Stop app ends it', (await appState())?.status === 'exited')
  await js(`window.orc.updateSpace(${JSON.stringify(c.sandbox)}, { runCommand: null })`)

  // Stop one worker from its card: a confirmation first, then only that worker ends.
  await openMission(m1)
  await sleep(600)
  await js(`document.querySelector('[data-testid=agent-card][data-agent=navbar] [data-testid=stop-worker]')?.click()`)
  await sleep(400)
  const confirmText = await js<string>(`document.querySelector('[data-testid=agent-card][data-agent=navbar] [data-testid=stop-worker-confirm]')?.textContent ?? ''`)
  check('the card asks before stopping a worker, and says what happens to its work', /Stop navbar\?/.test(confirmText) && /won't be committed or merged/.test(confirmText), confirmText)
  check('…nothing is stopped yet', view(m1).agents.find((a) => a.name === 'navbar')!.status !== 'exited')
  await shot('replay-stop-worker-confirm')
  await js(`document.querySelector('[data-testid=agent-card][data-agent=navbar] [data-testid=stop-worker-yes]')?.click()`)
  await sleep(800)
  const navbar = view(m1).agents.find((a) => a.name === 'navbar')!
  check('Stop worker ends only that worker', navbar.status === 'exited' && navbar.shutDown === true && view(m1).state === 'running', `${navbar.status} ${view(m1).state}`)
  check('…and its card and tree node are removed', (await count('[data-testid=agent-card][data-agent=navbar]')) === 0 && (await count('[data-testid=tree-node][data-agent=navbar]')) === 0)

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
  const err = await waitText('[data-testid=new-mission-error]', /\S/)
  check('starting a duplicate mission name shows an error', /already exists/.test(err), err)
  await shot('replay-duplicate-name')

  // A stopped mission keeps the workers Stop ended; the X on an exited card removes one.
  await js(`document.querySelector('[data-testid=new-mission-form] button[type=button]')?.click()`)
  await openMission(m1)
  await sleep(400)
  await js(`document.querySelector('[data-testid=stop-mission]')?.click()`)
  await sleep(1000)
  check('a stopped mission still shows its exited workers, with an X', (await count('[data-testid=agent-card][data-agent=post-api] [data-testid=dismiss-agent]')) === 1)
  await js(`document.querySelector('[data-testid=agent-card][data-agent=post-api] [data-testid=dismiss-agent]')?.click()`)
  await sleep(800)
  check('the X removes the exited worker', (await count('[data-testid=agent-card][data-agent=post-api]')) === 0 && view(m1).agents.find((a) => a.name === 'post-api')!.dismissed === true)
  await shot('replay-dismissed')

  await runWideTree(c, start, stamp)
}

/** A wide mission: 1 coordinator, 3 leads, 8 workers (3/3/2). Two of api's workers are done,
 *  so its "+2 done" chip folds them. Screenshots: chip folded, chip open, zoomed out. */
export async function runWideTree(c: ReplayCtx, start: (repoPath: string, name: string, gating?: string) => Promise<string>, stamp: string): Promise<void> {
  const { js, shot, check, log, sleep, missions } = c
  const limits = { max: missions.maxAgentsPerMission, live: missions.liveLimitFor }
  missions.maxAgentsPerMission = 20
  missions.liveLimitFor = () => 50
  try {
    const m = await start(c.sandbox, `smoke-r-wide-${stamp}`, 'none')
    const id = (a: string): string => `${m}:${a}`
    const hook = (a: string, e: Record<string, unknown>): void => void missions.hookEvent(id(a), { transcript_path: c.transcriptFixture, ...e } as never)
    const tree: Record<string, string[]> = { api: ['auth', 'billing', 'search'], ui: ['dashboard', 'settings', 'onboarding'], docs: ['guide', 'changelog'] }
    hook('coordinator', { hook_event_name: 'SessionStart' })
    for (const [lead, workers] of Object.entries(tree)) {
      await missions.spawnAgent(id('coordinator'), lead, `Lead the ${lead} area.`)
      for (const w of workers) await missions.spawnAgent(id(lead), w, `Build ${w}.`)
    }
    for (const a of Object.entries(tree).flat(2)) hook(a, { hook_event_name: 'SessionStart' })
    const work = (a: string): void => hook(a, { hook_event_name: 'UserPromptSubmit', prompt: `work on ${a}` })
    const needs = (a: string): void => hook(a, { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission' })
    for (const a of ['api', 'ui', 'search', 'dashboard', 'settings', 'changelog']) work(a)
    needs('ui'); needs('settings')
    missions.reportDone(id('auth'), 'Auth done.')
    missions.reportDone(id('billing'), 'Billing done.')
    await missions.gitWork
    await missions.refreshTokens()
    const agents = missions.views().find((v) => v.id === m)!.agents.length
    check('wide mission has 12 agents', agents === 12, String(agents))

    const missionRow = `document.querySelector('[data-testid=mission][data-mission=${JSON.stringify(`smoke-r-wide-${stamp}`)}] button')`
    await js(`(() => { const b = ${missionRow}; if (b && b.getAttribute('aria-expanded') !== 'true') b.click() })()`)
    await sleep(800)
    await js(`document.querySelector('[data-testid=tree-node][data-agent=coordinator]')?.click()`)
    await sleep(1200)
    const shape = (): Promise<{ nodes: number; folded: number; chips: string[] }> => js(`(() => {
      const chips = [...document.querySelectorAll('[data-testid=tree-chip]')].map((e) => e.textContent.trim());
      const folded = chips.reduce((s, t) => s + (/^\\+(\\d+)/.exec(t)?.[1] | 0), 0);
      return { nodes: document.querySelectorAll('[data-testid=tree-node]').length, folded, chips } })()`)
    const s1 = await shape()
    check('wide tree: visible nodes + folded = agents, with a "+2 done" chip', s1.nodes + s1.folded === agents && s1.chips.join() === '+2 done', JSON.stringify(s1))
    check('wide tree: the done workers are folded', (await js<number>(`document.querySelectorAll('[data-testid=tree-node][data-status=done]').length`)) === 0)
    await shot('wide-tree-chip-folded')

    // Rendered text size: font-size × zoom, and the on-screen height of the line box.
    const zoomNow = (): Promise<number> => js<number>(`(() => { const m = /scale\\(([\\d.]+)\\)/.exec(document.querySelector('.react-flow__viewport')?.style.transform ?? ''); return m ? +m[1] : -1 })()`)
    const measure = async (): Promise<string> => {
      const r = await js<Record<string, string>>(`(() => {
        const z = ${await zoomNow()};
        const at = (el) => el ? (parseFloat(getComputedStyle(el).fontSize) * z).toFixed(1) + 'px (css ' + getComputedStyle(el).fontSize + ', box h ' + el.getBoundingClientRect().height.toFixed(1) + 'px)' : 'none';
        const node = (a) => document.querySelector('[data-testid=tree-node][data-agent=' + JSON.stringify(a) + ']');
        return { zoom: String(z), lead: at(node('api')?.querySelector('span.font-medium')), worker: at(node('search')?.querySelector('span.font-medium')),
          leadStatus: at(node('api')?.querySelector('.text-muted-foreground span')), workerTokens: at(node('search')?.querySelector('.tabular-nums')),
          chip: at(document.querySelector('[data-testid=tree-chip]')) } })()`)
      return JSON.stringify(r)
    }
    const sizes = await measure()
    log(`wide tree text sizes: ${sizes}`)

    // Drag the tree/feed column's left edge 150px wider: the tree and the terminal refit after
    // the drag, with no ResizeObserver loop error. Double-click resets it.
    const panel = (): Promise<{ side: number; cols: number; zoom: number }> => js(`(() => ({
      side: Math.round(document.querySelector('aside [data-testid=side-resize]').parentElement.getBoundingClientRect().width),
      cols: document.querySelector('[data-testid=terminal]')?.orcTerm?.cols ?? -1,
      zoom: +(/scale\\(([\\d.]+)\\)/.exec(document.querySelector('.react-flow__viewport')?.style.transform ?? '')?.[1] ?? -1) }))()`)
    const before = await panel()
    log(`side panel before drag: ${JSON.stringify(before)}`)
    await js(`(async () => {
      window.__orcErrors = [];
      window.addEventListener('error', (e) => window.__orcErrors.push(String(e.message)));
      const h = document.querySelector('[data-testid=side-resize]'); const r = h.getBoundingClientRect();
      const x0 = r.left + r.width / 2, y = r.top + r.height / 2;
      const ev = (t, x) => h.dispatchEvent(new PointerEvent(t, { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: t === 'pointerup' ? 0 : 1, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      ev('pointerdown', x0);
      for (let i = 1; i <= 15; i++) { ev('pointermove', x0 - 10 * i); await new Promise((r) => requestAnimationFrame(r)); }
      ev('pointerup', x0 - 150) })()`)
    await sleep(1000)
    const after = await panel()
    log(`side panel after drag: ${JSON.stringify(after)}`)
    check('dragging the column edge widens it', after.side - before.side >= 140, `${before.side} → ${after.side}`)
    check('the terminal refits after the drag', after.cols > 0 && after.cols < before.cols, `${before.cols} → ${after.cols} cols`)
    check('the tree refits after the drag', after.zoom > 0 && after.zoom !== before.zoom, `${before.zoom} → ${after.zoom}`)
    await shot('side-panel-dragged')
    await js(`document.querySelector('[data-testid=side-resize]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
    await sleep(1000)
    const reset = await panel()
    // Reset goes to the default (420px, App.tsx SideDefault), not to `before`: a width saved by an earlier run may differ.
    check('double-clicking the edge resets the width', reset.side === 420 && reset.side < after.side, JSON.stringify(reset))
    const roErrors = await js<string[]>(`window.__orcErrors`)
    check('no ResizeObserver loop error while resizing', !roErrors.some((e) => /ResizeObserver/.test(e)), roErrors.join(' | '))

    await js(`document.querySelector('[data-testid=tree-chip]')?.click()`)
    await sleep(1000)
    const s2 = await shape()
    check('clicking the chip shows the done workers', s2.nodes === agents && s2.chips.join() === 'hide 2 done', JSON.stringify(s2))
    await shot('wide-tree-chip-open')
    await js(`document.querySelector('[data-testid=tree-chip]')?.click()`)
    await sleep(800)
    check('clicking it again folds them', (await shape()).nodes === agents - 2)

    // Fit-to-view floors at 0.6: zoom out with ctrl+wheel (a pinch, to React Flow).
    for (let i = 0; i < 20 && (await zoomNow()) >= 0.5; i++) {
      await js(`(() => { const p = document.querySelector('.react-flow__pane'); const r = p.getBoundingClientRect();
        p.dispatchEvent(new WheelEvent('wheel', { deltaY: 20, ctrlKey: true, bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 3 })) })()`)
      await sleep(60)
    }
    await sleep(500)
    const z = await zoomNow()
    check('the wide tree zooms out below 0.6', z > 0 && z < 0.6, String(z))
    const farSizes = await measure()
    log(`wide tree text sizes zoomed out: ${farSizes}`)
    await shot('wide-tree-zoomed-out')
  } finally {
    // Restored even when a step throws, so the raised limits can't leak into the rest of the run.
    missions.maxAgentsPerMission = limits.max
    missions.liveLimitFor = limits.live
  }
}
