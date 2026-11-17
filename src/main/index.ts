import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { appendFileSync, writeFileSync } from 'node:fs'
import type { StartMissionRequest } from '../shared/types'
import { ControlServer } from './control-server'
import { Missions } from './missions'
import { TerminalHost } from './terminals'

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
const control = new ControlServer({
  agentForToken: (t) => missions.agentForToken(t),
  spawnAgent: (c, n, t) => missions.spawnAgent(c, n, t),
  reportDone: (c, s) => missions.reportDone(c, s),
  askHuman: (c, q) => missions.askHuman(c, q),
  hookEvent: (c, e) => {
    // Raw payloads, so status bugs can be diagnosed from a file.
    try {
      appendFileSync(join(app.getPath('userData'), 'hooks.jsonl'), JSON.stringify({ at: Date.now(), agent: c, ...e }) + '\n')
    } catch {}
    missions.hookEvent(c, e)
  }
})

const smoke = process.env.ORC_SMOKE_OUT ?? null

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
      contextIsolation: true
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

ipcMain.handle('missions:list', () => missions.views())
ipcMain.handle('missions:start', (_e, req: StartMissionRequest) => missions.startMission(req))
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

/** ORC_SMOKE_OUT=<dir>: never shows the window. Loads the UI hidden, optionally starts a
 *  mission in ORC_SMOKE_REPO without prompting it, writes errors, a screenshot and the
 *  coordinator's terminal output to <dir>, then quits and kills every session. */
async function runSmoke(dir: string): Promise<void> {
  const errors: string[] = []
  win!.webContents.on('console-message', (e) => {
    if (e.level === 'error') errors.push(e.message)
  })
  await new Promise<void>((r) => win!.webContents.once('did-finish-load', () => r()))
  await new Promise((r) => setTimeout(r, 2000))
  const rootChildren = await win!.webContents.executeJavaScript(
    "document.getElementById('root')?.childElementCount ?? -1"
  )
  let coordinator = ''
  if (process.env.ORC_SMOKE_REPO) {
    const id = await missions.startMission({
      repoPath: process.env.ORC_SMOKE_REPO,
      name: 'smoke',
      permissionMode: 'acceptEdits'
    })
    await new Promise((r) => setTimeout(r, 12000))
    coordinator = terminals.replay(`${id}:coordinator`)
    await win!.webContents.executeJavaScript('void 0')
  }
  writeFileSync(join(dir, 'screenshot.png'), (await win!.webContents.capturePage()).toPNG())
  writeFileSync(join(dir, 'coordinator.txt'), coordinator)
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ rootChildren, errors, missions: missions.views() }, null, 2))
  missions.shutdown()
  control.close()
  app.exit(0)
}

app.whenReady().then(async () => {
  missions.setControlPort(await control.listen())
  createWindow()
  if (smoke) void runSmoke(smoke)
})
app.on('window-all-closed', () => {
  win = null
  missions.shutdown()
  control.close()
  app.quit()
})
