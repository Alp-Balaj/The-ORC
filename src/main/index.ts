import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron'
import { join } from 'node:path'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import type { PermissionMode, StartMissionRequest } from '../shared/types.ts'
import type { SpacePatch } from '../preload/index.ts'
import { ControlServer } from './control-server.ts'
import { renameOver } from './rename-over.ts'
import { Missions } from './missions.ts'
import { startStatusPoller } from './agent-status.ts'
import { runSmoke } from './smoke.ts'
import { fakeLauncher } from './smoke-replay.ts'
import { Spaces } from './spaces.ts'
import { TerminalHost } from './terminals.ts'
import { AppRunner } from './app-runner.ts'
import { Queues } from './queue.ts'
import { PlanUsage } from './plan-usage.ts'

let win: BrowserWindow | null = null

/** Sessions keep emitting while the app shuts down; never send to a destroyed window. */
function send(channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, ...args)
}

const terminals = new TerminalHost(
  (id, data) => send('terminal:data', id, data),
  (id, code) => {
    missions.terminalExited(id, code)
    appRunner.terminalExited(id, code)
    send('terminal:exit', id, code)
  }
)
/** Created after spaces (below); missions can change before that. */
let queues: Queues | null = null
const missions = new Missions(terminals, (views) => {
  send('missions:changed', views)
  scheduleSave()
  queues?.onMissions(views)
})
const appRunner = new AppRunner(terminals, (run) => send('app:changed', run))
missions.gateCommandFor = (repo) => spaces.gateCommand(repo)
missions.liveLimitFor = (repo) => spaces.maxLive(repo)
missions.recordsDirFor = (repo) => spaces.recordsPath(repo)
missions.spaceModelsFor = (repo) => spaces.models(repo)
const planUsage = new PlanUsage((u) => {
  send('usage:changed', u)
  queues?.onUsage()
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
const control = new ControlServer({
  agentForToken: (t) => missions.agentForToken(t),
  spawnAgent: (c, n, t) => missions.spawnAgent(c, n, t),
  reportDone: (c, s) => missions.reportDone(c, s),
  askHuman: (c, q) => missions.askHuman(c, q),
  stopAgent: (c, n, r) => missions.stopAgent(c, n, r),
  proposeSplit: (c, s, w) => missions.proposeSplit(c, s, w),
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
  usage: () => planUsage.view(),
  emit: (q) => send('queue:changed', q),
  file: smoke ? null : join(app.getPath('userData'), 'queue.json')
})
const queue = queues
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
ipcMain.handle('app:run', async (_e, id: string) => {
  const m = missions.views().find((x) => x.id === id)
  if (!m) throw new Error('no such mission')
  if (m.mergedToMain) throw new Error("this mission was merged to main and its worktree removed. Run the app from your own checkout.")
  const command = spaces.runCommand(m.repoPath)
  if (!command) throw new Error(`no run command for ${m.repoPath.split(/[\/]/).pop()}: set one in the space settings (the gear next to the space)`)
  const cwd = await missions.ensureIntegration(id)
  await appRunner.run(m.id, m.name, cwd, command)
})
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
ipcMain.handle('missions:merge-to-main', async (_e, id: string) => {
  // Its worktree is removed after the merge; on Windows a running app would hold it open.
  await appRunner.stopFor(id)
  return missions.mergeToMain(id)
})
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
ipcMain.handle('queue:reorder', (_e, root: string, ids: string[]) => queue.reorder(root, ids))
ipcMain.handle('queue:start', (_e, root: string, permissionMode: PermissionMode) => queue.start(root, permissionMode))
ipcMain.handle('queue:pause', (_e, root: string) => queue.pause(root))
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
ipcMain.on('theme:set-native', (_e, pref: 'light' | 'dark' | 'system') => {
  nativeTheme.themeSource = pref
  for (const w of BrowserWindow.getAllWindows()) w.setBackgroundColor(windowBackground())
})
ipcMain.on('terminal:resize', (_e, id: string, cols: number, rows: number) =>
  terminals.resize(id, cols, rows)
)

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
