import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { TerminalHost } from './terminals'

let win: BrowserWindow | null = null

const host = new TerminalHost(
  (id, data) => win?.webContents.send('terminal:data', id, data),
  (id, code) => win?.webContents.send('terminal:exit', id, code)
)

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
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

ipcMain.handle('terminal:start-shell', (_e, id: string) => {
  if (!host.isRunning(id)) {
    host.start({ id, command: process.env.SHELL ?? 'bash', args: [], cwd: homedir() })
  }
})
ipcMain.handle('terminal:replay', (_e, id: string) => host.replay(id))
ipcMain.on('terminal:write', (_e, id: string, data: string) => host.write(id, data))
ipcMain.on('terminal:resize', (_e, id: string, cols: number, rows: number) =>
  host.resize(id, cols, rows)
)

app.whenReady().then(createWindow)
app.on('window-all-closed', () => {
  host.killAll()
  app.quit()
})
