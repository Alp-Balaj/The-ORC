import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import type { StartMissionRequest } from '../shared/types'
import { ControlServer } from './control-server'
import { Missions } from './missions'
import { TerminalHost } from './terminals'

let win: BrowserWindow | null = null

const terminals = new TerminalHost(
  (id, data) => win?.webContents.send('terminal:data', id, data),
  (id, code) => {
    missions.terminalExited(id)
    win?.webContents.send('terminal:exit', id, code)
  }
)
const missions = new Missions(terminals, (views) => win?.webContents.send('missions:changed', views))
const control = new ControlServer(missions)

function createWindow(): void {
  win = new BrowserWindow({
    width: 1500,
    height: 920,
    title: 'The ORC',
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

app.whenReady().then(async () => {
  missions.setControlPort(await control.listen())
  createWindow()
})
app.on('window-all-closed', () => {
  missions.shutdown()
  control.close()
  app.quit()
})
