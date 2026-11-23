import { app, type IpcMain } from 'electron'
import { execFile } from 'node:child_process'
import { join } from 'node:path'

let running: Promise<string> | null = null

/** Runs `scripts/orc-app.sh rebuild`: moves the stable copy to the latest main and rebuilds it. Never starts or quits an app. */
export function updateApp(script = join(app.getAppPath(), 'scripts', 'orc-app.sh')): Promise<string> {
  running ??= new Promise<string>((resolve, reject) => {
    execFile('bash', [script, 'rebuild'], { maxBuffer: 16 * 1024 * 1024, timeout: 20 * 60_000 }, (err, stdout, stderr) => {
      running = null
      if (!err) return resolve('Updated')
      const tail = `${stderr}\n${stdout}`.trim().split('\n').slice(-6).join('\n')
      reject(new Error(`Update failed: ${tail || err.message}`))
    })
  })
  return running
}

/** Channel: app-update:run */
export function registerAppUpdateIpc(ipcMain: IpcMain): void {
  ipcMain.handle('app-update:run', () => updateApp())
}
