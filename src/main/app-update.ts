import { app, type IpcMain } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

let running: Promise<string> | null = null

/** True when this process runs from the stable copy that scripts/orc-app.sh builds (not dev, not a worktree's Run app copy). */
function isStableCopy(): boolean {
  const stable = resolve(process.env.ORC_APP_DIR ?? join(homedir(), '.local', 'share', 'the-orc', 'app'))
  return resolve(app.getAppPath()) === stable && !process.env.ORC_SMOKE_OUT
}

/** Starts the freshly built stable copy once this process has exited (it holds the single-instance lock until then). */
function relaunchAfterExit(appDir: string): void {
  const child = spawn('bash', ['-c', 'while kill -0 "$1" 2>/dev/null; do sleep 0.3; done; exec node_modules/.bin/electron . >/dev/null 2>&1', 'orc-relaunch', String(process.pid)], { cwd: appDir, detached: true, stdio: 'ignore' })
  child.unref()
}

/** Runs `scripts/orc-app.sh rebuild`: moves the stable copy to the latest main and rebuilds it.
 *  If this app is the stable copy, it then quits (the normal quit path saves and resumes missions) and a detached shell starts the new build. */
export function updateApp(script = join(app.getAppPath(), 'scripts', 'orc-app.sh')): Promise<string> {
  running ??= new Promise<string>((resolveRun, reject) => {
    execFile('bash', [script, 'rebuild'], { maxBuffer: 16 * 1024 * 1024, timeout: 20 * 60_000 }, (err, stdout, stderr) => {
      running = null
      if (!err) {
        if (!isStableCopy()) return resolveRun('Updated')
        relaunchAfterExit(app.getAppPath())
        setTimeout(() => app.quit(), 300)
        return resolveRun('Restarting')
      }
      const tail = `${stderr}\n${stdout}`.trim().split('\n').slice(-6).join('\n')
      reject(new Error(`Update failed: ${tail || err.message}`))
    })
  })
  return running
}

/** Channel: app-update:run */
export function registerAppUpdateIpc(ipcMain: IpcMain): void {
  ipcMain.handle('app-update:run', () => updateApp())
  ipcMain.handle('app-update:can-restart', () => isStableCopy())
}
