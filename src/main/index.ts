import { app, BrowserWindow, dialog, ipcMain, nativeTheme, Notification } from 'electron'
import { join } from 'node:path'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import type { AutopilotPatch, MissionView, PermissionMode, StartMissionRequest } from '../shared/types.ts'
import type { SpacePatch } from '../preload/index.ts'
import { ControlServer } from './control-server.ts'
import { HistoryIndex } from './history-index.ts'
import { renameOver } from './rename-over.ts'
import { Missions } from './missions.ts'
import { startStatusPoller } from './agent-status.ts'
import { runSmoke } from './smoke.ts'
import { fakeLauncher } from './smoke-replay.ts'
import { Spaces } from './spaces.ts'
import { Notifier } from './notifications.ts'
import { TerminalHost } from './terminals.ts'
import { AppRunner } from './app-runner.ts'
import { Queues } from './queue.ts'
import { Autopilots } from './autopilot.ts'
import { PlanUsage } from './plan-usage.ts'

let win: BrowserWindow | null = null

/** Sessions keep emitting while the app shuts down; never send to a destroyed window. */
function send(channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, ...args)
}

/** Pty output reaches the window in batches: one message per terminal every ~16ms instead of one
 *  per chunk. An exit flushes first, so the window always sees a session's output before its exit. */
const pendingData = new Map<string, string>()
let dataTimer: ReturnType<typeof setTimeout> | null = null
function flushData(): void {
  if (dataTimer) clearTimeout(dataTimer)
  dataTimer = null
  for (const [id, data] of pendingData) send('terminal:data', id, data)
  pendingData.clear()
}
function queueData(id: string, data: string): void {
  pendingData.set(id, (pendingData.get(id) ?? '') + data)
  dataTimer ??= setTimeout(flushData, 16)
}

const terminals = new TerminalHost(
  (id, data) => queueData(id, data),
  (id, code) => {
    missions.terminalExited(id, code)
    appRunner.terminalExited(id, code)
    flushData()
    send('terminal:exit', id, code)
  }
)
/** Created after spaces (below); missions can change before that. */
let queues: Queues | null = null
let autopilots: Autopilots | null = null
/** Desktop notifications: no-ops in smoke runs, which must never pop real ones. */
const notifier = new Notifier({
  show: ({ title, body, urgent }, onClick) => {
    if (process.env.ORC_SMOKE_OUT || !Notification.isSupported()) return
    const n = new Notification({ title, body, urgency: urgent ? 'critical' : 'normal' })
    n.on('click', onClick)
    n.show()
  },
  setBadge: (count) => {
    if (!process.env.ORC_SMOKE_OUT) app.setBadgeCount(count)
  },
  flash: (on) => {
    if (!process.env.ORC_SMOKE_OUT && win && !win.isDestroyed()) win.flashFrame(on)
  },
  isFocused: () => !!win && !win.isDestroyed() && win.isFocused(),
  select: (missionId, terminalId) => {
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    send('notify:select', missionId, terminalId)
  },
  enabled: (repo) => spaces.notifications(repo)
})
/** Mission state is pushed only while the window is on screen. Pushes made while it is hidden
 *  are skipped and sent once when it is shown again (smoke runs are hidden by design: always send). */
let missionsDirty = false
function sendMissions(views: MissionView[]): void {
  const shown = !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized()
  if (!shown && !process.env.ORC_SMOKE_OUT) {
    missionsDirty = true
    return
  }
  missionsDirty = false
  send('missions:changed', views)
}
const missions = new Missions(terminals, (views) => {
  sendMissions(views)
  scheduleSave()
  queues?.onMissions(views)
  notifier.onMissions(views)
})
const appRunner = new AppRunner(terminals, (run) => send('app:changed', run))
missions.gateCommandFor = (repo) => spaces.gateCommand(repo)
missions.idleStopMinutesFor = (repo) => spaces.idleStopMinutes(repo)
missions.liveLimitFor = (repo) => spaces.maxLive(repo)
missions.recordsDirFor = (repo) => spaces.recordsPath(repo)
missions.spaceModelsFor = (repo) => spaces.models(repo)
const planUsage = new PlanUsage((u) => {
  send('usage:changed', u)
  queues?.onUsage()
  autopilots?.onUsage()
})
missions.statusLine = (s) => planUsage.update(s)
// Smoke runs that must survive a restart (the crash test) use fake sessions from the start.
if (process.env.ORC_SMOKE_OUT && process.env.ORC_SMOKE_FAKE) {
  missions.launcher = fakeLauncher
  // The Verifier now runs on its own; fake sessions must never start a billed claude -p.
  missions.verify = async () => ({ ok: true, report: 'VERDICT: PASS', promptHash: 'f'.repeat(64) })
}

/** Missions survive restarts (M4). Smoke runs keep their state under ORC_SMOKE_OUT, never in
 *  the owner's userData; ORC_STATE_FILE overrides (the crash test relaunches on one file). */
function stateFile(): string {
  return process.env.ORC_STATE_FILE ?? (smoke ? join(smoke, 'missions.json') : join(app.getPath('userData'), 'missions.json'))
}
let saveTimer: ReturnType<typeof setTimeout> | null = null
/** Set when quitting: killing sessions marks agents exited, and that must not be saved, or
 *  nothing would resume next time. */
let frozen = false
function scheduleSave(): void {
  if (saveTimer || frozen) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveNow()
  }, 300)
}
function saveNow(): void {
  if (frozen) return
  try {
    const file = stateFile()
    writeFileSync(`${file}.tmp`, JSON.stringify(missions.snapshot()))
    renameOver(`${file}.tmp`, file)
  } catch (err) {
    console.error('could not save missions', err)
  }
}
function isOrphan(pid: number, sessionId: string): boolean {
  try {
    if (process.platform === 'win32') {
      // No /proc on Windows: ask WMI for the process's command line.
      const cmdline = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${Math.trunc(pid)}").CommandLine`],
        { encoding: 'utf8', timeout: 10_000, windowsHide: true }
      )
      return cmdline.includes(sessionId)
    }
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(sessionId)
  } catch {
    return false
  }
}
let historyIndex: HistoryIndex | null = null
const control = new ControlServer({
  agentForToken: (t) => missions.agentForToken(t),
  spawnAgent: (c, n, t) => missions.spawnAgent(c, n, t),
  reportDone: (c, s) => missions.reportDone(c, s),
  askHuman: (c, q) => missions.askHuman(c, q),
  stopAgent: (c, n, r) => missions.stopAgent(c, n, r),
  proposeSplit: (c, s, w) => missions.proposeSplit(c, s, w),
  integrateMission: (c) => missions.integrateMission(c),
  searchHistory: (c, query, limit) => {
    const m = missions.views().find((v) => v.agents.some((a) => a.terminalId === c))
    if (!m) return 'search_history: unknown caller (no mission found for this session).'
    historyIndex ??= new HistoryIndex(join(smoke ?? app.getPath('userData'), 'history-index.sqlite'))
    return historyIndex.search({ recordsDir: spaces.recordsPath(m.repoPath), repoRoot: m.repoPath, query, limit: limit ?? undefined })
  },
  addToQueue: (c, tasks) => {
    const info = missions.callerInfo(c)
    if (!info) return 'add_to_queue: unknown caller (no mission found for this session).'
    if (info.role !== 'coordinator') return 'add_to_queue: refused. Only the mission coordinator can add tasks to the queue; tell your coordinator instead.'
    if (!queues) return 'add_to_queue: the queue is not ready yet; try again in a moment.'
    queues.addMany(info.repoPath, tasks)
    const titles = tasks.map((t) => `"${t.title.trim()}"`).join(', ')
    return `Added ${tasks.length} task${tasks.length === 1 ? '' : 's'} to the queue of ${info.repoPath}: ${titles}. The human starts the queue from the sidebar (or it continues if running).`
  },
  hookEvent: (c, e) => {
    // Raw payloads, so status bugs can be diagnosed from a file.
    try {
      appendFileSync(join(app.getPath('userData'), 'hooks.jsonl'), JSON.stringify({ at: Date.now(), agent: c, ...e }) + '\n')
    } catch {}
    return missions.hookEvent(c, e)
  }
})

const smoke = process.env.ORC_SMOKE_OUT ?? null
// One instance owns the missions: a second one would treat the first's live sessions as
// orphans, kill them and resume them itself, and both would write the state file.
if (!smoke && !app.requestSingleInstanceLock()) {
  app.exit(0)
}
app.on('second-instance', () => {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

// Test runs never touch the owner's saved spaces.
// Mission records default to <userData>/records (smoke runs: their own out dir).
const spaces = new Spaces(smoke ? null : join(app.getPath('userData'), 'spaces.json'), join(smoke ?? app.getPath('userData'), 'records'))
// The backlog queue (smoke runs: memory only).
queues = new Queues({
  missions,
  usageThreshold: (root) => spaces.usageThreshold(root),
  maxParallel: (root) => spaces.maxParallel(root),
  usage: () => planUsage.view(),
  emit: (q) => {
    send('queue:changed', q)
    autopilots?.onQueues()
  },
  file: smoke ? null : join(app.getPath('userData'), 'queue.json')
})
const queue = queues
// Autopilot: refills an empty queue with discovered tasks (off by default per space).
autopilots = new Autopilots({
  queue,
  usageThreshold: (root) => spaces.usageThreshold(root),
  usage: () => planUsage.view(),
  emit: (a) => send('autopilot:changed', a),
  file: smoke ? null : join(app.getPath('userData'), 'autopilot.json')
})
const autopilot = autopilots
if (smoke) {
  // A hidden window stops producing frames after a while; screenshots then never arrive.
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  app.commandLine.appendSwitch('disable-background-timer-throttling')
}

const windowBackground = (): string => (nativeTheme.shouldUseDarkColors ? '#0b0b0d' : '#f7f7f8')

function createWindow(): void {
  // ORC_SMOKE_SIZE=1280x800 sets a smoke window's size.
  const size = smoke ? /^(\d+)x(\d+)$/.exec(process.env.ORC_SMOKE_SIZE ?? '') : null
  win = new BrowserWindow({
    width: size ? +size[1] : 1500,
    height: size ? +size[2] : 920,
    title: 'The ORC',
    show: !smoke,
    backgroundColor: windowBackground(),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      // A hidden smoke window must still paint terminals for screenshots.
      backgroundThrottling: !smoke,
      // Hidden windows on Wayland stop producing frames after the first; offscreen
      // rendering keeps painting, so smoke screenshots stay live.
      offscreen: !!smoke
    }
  })
  win.on('focus', () => notifier.onFocus())
  // Catch the renderer up on mission pushes it missed while hidden or minimized.
  const catchUp = (): void => {
    if (missionsDirty && win && !win.isDestroyed()) sendMissions(missions.views())
  }
  win.on('show', catchUp)
  win.on('restore', catchUp)
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

/** Missions that restore() brought back at launch, for the "Resumed N missions" banner. */
let resumedAtLaunch: { id: string; name: string }[] = []
ipcMain.handle('missions:list', () => missions.views())
ipcMain.handle('missions:resumed-at-launch', () => resumedAtLaunch)
ipcMain.handle('missions:stop-resumed', () => {
  for (const m of resumedAtLaunch) missions.stopMission(m.id)
  resumedAtLaunch = []
})
ipcMain.handle('missions:dismiss-resumed', () => {
  resumedAtLaunch = []
})
ipcMain.handle('missions:start', async (_e, req: StartMissionRequest) => {
  await spaces.add(req.repoPath)
  send('spaces:changed', spaces.list())
  return missions.startMission(req)
})
ipcMain.handle('missions:stop', (_e, id: string) => missions.stopMission(id))
ipcMain.handle('missions:restart', (_e, id: string) => missions.restartMission(id))
ipcMain.handle('missions:pause', (_e, id: string) => missions.pauseMission(id))
ipcMain.handle('missions:remove', async (_e, id: string) => {
  await appRunner.stopFor(id)
  return missions.removeMission(id)
})
/** The app saved in app-run.json that passed the checks at launch, waiting for the owner's
 *  Start again (owner, 2026-11-22: a button instead of restarting it on its own). */
let pendingAppRestore: { missionId: string; missionName: string } | null = null
ipcMain.handle('app:pending-restore', () => pendingAppRestore)
ipcMain.handle('app:restore-start', async () => {
  if (!pendingAppRestore) return
  await runApp(pendingAppRestore.missionId)
})
ipcMain.handle('app:restore-dismiss', () => {
  pendingAppRestore = null
  appRunner.clearSaved()
})
ipcMain.handle('app:run', (_e, id: string) => runApp(id))
async function runApp(id: string): Promise<void> {
  const m = missions.views().find((x) => x.id === id)
  if (!m) throw new Error('no such mission')
  if (m.mergedToMain) throw new Error("this mission was merged to main and its worktree removed. Run the app from your own checkout.")
  const command = spaces.runCommand(m.repoPath)
  if (!command) throw new Error(`no run command for ${m.repoPath.split(/[\/]/).pop()}: set one in the space settings (the gear next to the space)`)
  const cwd = await missions.ensureIntegration(id)
  await appRunner.run(m.id, m.name, cwd, command)
  pendingAppRestore = null
}
ipcMain.handle('app:stop', () => appRunner.stop())
ipcMain.handle('app:current', () => appRunner.view())
ipcMain.handle('missions:resume', (_e, id: string) => missions.resumeMission(id))
ipcMain.handle('spaces:update', (_e, root: string, patch: SpacePatch) => {
  spaces.update(root, patch)
  send('spaces:changed', spaces.list())
})
ipcMain.handle('missions:decide-split', (_e, id: string, approve: boolean, note: string | null) => missions.decideSplit(id, approve, note))
ipcMain.handle('missions:approve-worker', (_e, id: string, agent: string) => missions.approveWorker(id, agent))
ipcMain.handle('missions:stop-worker', (_e, id: string, agent: string) => missions.stopWorker(id, agent))
ipcMain.handle('missions:dismiss-agent', (_e, id: string, agent: string) => missions.dismissAgent(id, agent))
ipcMain.handle('missions:send-back', (_e, id: string, agent: string, note: string) => missions.sendBack(id, agent, note))
ipcMain.handle('missions:worker-diff', (_e, id: string, agent: string) => missions.workerDiff(id, agent))
ipcMain.handle('missions:diff', (_e, id: string) => missions.missionDiff(id))
ipcMain.handle('missions:run-gate', (_e, id: string) => {
  const m = missions.views().find((x) => x.id === id)
  return m ? missions.runGate(id, spaces.gateCommand(m.repoPath)) : undefined
})
ipcMain.handle('missions:run-verifier', (_e, id: string) => missions.runVerifier(id))
ipcMain.handle('missions:integrate', (_e, id: string) => missions.integrate(id))
ipcMain.handle('orc:diff', (_e, repo: string) => missions.orcDiff(repo))
ipcMain.handle('orc:merge-to-main', async (_e, repo: string) => {
  // Merged missions' worktrees are removed after the merge; on Windows a running app would hold one open.
  for (const m of missions.views()) if (m.repoPath === repo && m.integrated && !m.mergedToMain) await appRunner.stopFor(m.id)
  return missions.mergeToMain(repo)
})
ipcMain.handle('orc:push-target', (_e, repo: string) => missions.pushTarget(repo))
ipcMain.handle('orc:push', (_e, repo: string) => missions.pushMain(repo))
ipcMain.handle('spaces:set-gate', (_e, root: string, command: string | null) => {
  spaces.setGateCommand(root, command)
  send('spaces:changed', spaces.list())
})
ipcMain.handle('spaces:list', () => spaces.list())
ipcMain.handle('queue:list', () => queue.list())
ipcMain.handle('queue:add', async (_e, root: string, title: string, details: string) => {
  const space = await spaces.add(root)
  send('spaces:changed', spaces.list())
  queue.add(space, title, details)
})
ipcMain.handle('queue:update', (_e, root: string, id: string, patch: { title?: string; details?: string }) => queue.update(root, id, patch))
ipcMain.handle('queue:remove', (_e, root: string, id: string) => queue.remove(root, id))
ipcMain.handle('queue:clear', (_e, root: string, scope: 'done' | 'all') => queue.clear(root, scope))
ipcMain.handle('queue:reorder', (_e, root: string, ids: string[]) => queue.reorder(root, ids))
ipcMain.handle('queue:start', (_e, root: string, permissionMode: PermissionMode) => queue.start(root, permissionMode))
ipcMain.handle('queue:pause', (_e, root: string) => queue.pause(root))
ipcMain.handle('autopilot:list', () => autopilot.list())
ipcMain.handle('autopilot:set', (_e, root: string, patch: AutopilotPatch) => autopilot.set(root, patch))
ipcMain.handle('usage:get', () => planUsage.view())
ipcMain.handle('spaces:add', async (_e, path: string) => {
  const root = await spaces.add(path)
  send('spaces:changed', spaces.list())
  return root
})
ipcMain.handle('spaces:remove', (_e, root: string) => {
  spaces.remove(root)
  send('spaces:changed', spaces.list())
})
ipcMain.handle('dialog:pick-repo', async () => {
  const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
  return r.canceled ? null : r.filePaths[0]
})
ipcMain.handle('terminal:replay', (_e, id: string) => terminals.replay(id))
ipcMain.on('terminal:write', (_e, id: string, data: string) => {
  missions.noteHumanInput(id, data)
  terminals.write(id, data)
})
ipcMain.on('ui:selection', (_e, missionId: string | null, terminalId: string | null) => notifier.setSelection(missionId, terminalId))
ipcMain.on('theme:set-native', (_e, pref: 'light' | 'dark' | 'system') => {
  nativeTheme.themeSource = pref
  for (const w of BrowserWindow.getAllWindows()) w.setBackgroundColor(windowBackground())
})
ipcMain.on('terminal:resize', (_e, id: string, cols: number, rows: number) =>
  terminals.resize(id, cols, rows)
)

/** Offers to bring back (Start again) the app the owner ran with Run app before The ORC quit,
 *  if its mission is still there, not merged to main, and the space still has a run command. */
async function restoreAppRun(): Promise<void> {
  appRunner.file = smoke ? join(smoke, 'app-run.json') : join(app.getPath('userData'), 'app-run.json')
  const saved = appRunner.saved()
  if (!saved) return
  try {
    const m = missions.views().find((x) => x.id === saved.missionId)
    const command = m && !m.mergedToMain ? spaces.runCommand(m.repoPath) : null
    if (!m || !command) return await appRunner.stop() // forgets the saved run
    pendingAppRestore = { missionId: m.id, missionName: m.name }
  } catch (err) {
    console.error('could not restore the running app', err)
  }
}

app.whenReady().then(async () => {
  missions.setControlPort(await control.listen())
  // Recovery before anything else: reattach the missions that were running.
  if (existsSync(stateFile())) {
    try {
      const done = await missions.restore(JSON.parse(readFileSync(stateFile(), 'utf8')), {
        isOrphan,
        kill: (pid) => {
          try {
            process.kill(pid, 'SIGKILL')
          } catch {}
        }
      })
      if (done.length) console.log(`recovered:\n  ${done.join('\n  ')}`)
      // The banner in the window lists the missions that came back (owner, 2026-11-22).
      const back = new Set(done.filter((l) => /: (resumed|restarted)$/.test(l)).map((l) => l.split('/')[0]))
      resumedAtLaunch = missions.views().filter((m) => back.has(m.name)).map((m) => ({ id: m.id, name: m.name }))
    } catch (err) {
      console.error('could not restore missions', err)
    }
  }
  queue.onMissions(missions.views())
  await restoreAppRun()
  startStatusPoller(() => missions.liveSessionIds(), (s) => missions.reconcile(s))
  setInterval(() => void missions.refreshTokens(), 5000).unref()
  createWindow()
  if (smoke) {
    const shutdown = (): void => {
      saveNow()
      frozen = true
      missions.shutdown()
      control.close()
    }
    // Hard watchdog: whatever happens, no session outlives the test.
    const hardMs = (Number(process.env.ORC_SMOKE_TIMEOUT_S ?? 480) + 90) * 1000
    setTimeout(() => {
      console.error('SMOKE watchdog fired: killing every session')
      shutdown()
      app.exit(3)
    }, hardMs).unref()
    void runSmoke(smoke, { win: win!, missions, terminals, userData: app.getPath('userData'), appPath: app.getAppPath(), shutdown, quit: () => app.quit() })
      .then((ok) => {
        shutdown()
        app.exit(ok ? 0 : 1)
      })
      .catch((err) => {
        console.error('SMOKE crashed', err)
        shutdown()
        app.exit(2)
      })
  }
})
// app.quit() and Ctrl+Q skip window-all-closed and go through before-quit: save there too,
// before sessions are killed, then freeze.
app.on('before-quit', () => {
  saveNow()
  frozen = true
})
app.on('window-all-closed', () => {
  win = null
  saveNow()
  frozen = true
  appRunner.shutdown()
  missions.shutdown()
  control.close()
  app.quit()
})
