import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { appendFileSync } from 'node:fs'
import type { StartMissionRequest } from '../shared/types.ts'
import { ControlServer } from './control-server.ts'
import { Missions } from './missions.ts'
import { startStatusPoller } from './agent-status.ts'
import { runSmoke } from './smoke.ts'
import { Spaces } from './spaces.ts'
import { TerminalHost } from './terminals.ts'

let win: BrowserWindow | null = null

/** Sessions keep emitting while the app shuts down; never send to a destroyed window. */
function send(channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, ...args)
}

const terminals = new TerminalHost(
  (id, data) => send('terminal:data', id, data),
  (id, code) => {
    missions.terminalExited(id)
    send('terminal:exit', id, code)
  }
)
const missions = new Missions(terminals, (views) => send('missions:changed', views))
missions.gateCommandFor = (repo) => spaces.gateCommand(repo)
const control = new ControlServer({
  agentForToken: (t) => missions.agentForToken(t),
  spawnAgent: (c, n, t) => missions.spawnAgent(c, n, t),
  reportDone: (c, s) => missions.reportDone(c, s),
  askHuman: (c, q) => missions.askHuman(c, q),
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
// Test runs never touch the owner's saved spaces.
const spaces = new Spaces(smoke ? null : join(app.getPath('userData'), 'spaces.json'))
if (smoke) {
  // A hidden window stops producing frames after a while; screenshots then never arrive.
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  app.commandLine.appendSwitch('disable-background-timer-throttling')
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1500,
    height: 920,
    title: 'The ORC',
    show: !smoke,
    backgroundColor: '#0b0d10',
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

ipcMain.handle('missions:list', () => missions.views())
ipcMain.handle('missions:start', async (_e, req: StartMissionRequest) => {
  await spaces.add(req.repoPath)
  send('spaces:changed', spaces.list())
  return missions.startMission(req)
})
ipcMain.handle('missions:stop', (_e, id: string) => missions.stopMission(id))
ipcMain.handle('missions:decide-split', (_e, id: string, approve: boolean, note: string | null) => missions.decideSplit(id, approve, note))
ipcMain.handle('missions:approve-worker', (_e, id: string, agent: string) => missions.approveWorker(id, agent))
ipcMain.handle('missions:send-back', (_e, id: string, agent: string, note: string) => missions.sendBack(id, agent, note))
ipcMain.handle('missions:worker-diff', (_e, id: string, agent: string) => missions.workerDiff(id, agent))
ipcMain.handle('missions:diff', (_e, id: string) => missions.missionDiff(id))
ipcMain.handle('missions:run-gate', (_e, id: string) => {
  const m = missions.views().find((x) => x.id === id)
  return m ? missions.runGate(id, spaces.gateCommand(m.repoPath)) : undefined
})
ipcMain.handle('missions:run-verifier', (_e, id: string) => missions.runVerifier(id))
ipcMain.handle('missions:merge-to-main', (_e, id: string) => missions.mergeToMain(id))
ipcMain.handle('spaces:set-gate', (_e, root: string, command: string | null) => {
  spaces.setGateCommand(root, command)
  send('spaces:changed', spaces.list())
})
ipcMain.handle('spaces:list', () => spaces.list())
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
ipcMain.on('terminal:resize', (_e, id: string, cols: number, rows: number) =>
  terminals.resize(id, cols, rows)
)

app.whenReady().then(async () => {
  missions.setControlPort(await control.listen())
  startStatusPoller(() => missions.liveSessionIds(), (s) => missions.reconcile(s))
  setInterval(() => void missions.refreshTokens(), 5000).unref()
  createWindow()
  if (smoke) {
    const shutdown = (): void => {
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
    void runSmoke(smoke, { win: win!, missions, terminals, userData: app.getPath('userData'), appPath: app.getAppPath(), shutdown })
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
app.on('window-all-closed', () => {
  win = null
  missions.shutdown()
  control.close()
  app.quit()
})
