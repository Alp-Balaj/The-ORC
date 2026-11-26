import { app, shell, type IpcMain } from 'electron'
import { execFile } from 'node:child_process'
import { access, chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type DesktopShortcutResult = { status: 'created' | 'exists' | 'unsupported'; path?: string; message: string }

const exists = (path: string): Promise<boolean> => access(path).then(() => true, () => false)

/** Windows: a .lnk that runs scripts/orc-launch.vbs (same target as scripts/install-shortcut.ps1). */
async function createWindows(repo: string, desktop: string): Promise<DesktopShortcutResult> {
  const lnk = join(desktop, 'The ORC.lnk')
  if (await exists(lnk)) return { status: 'exists', path: lnk, message: 'The ORC is already on the Desktop.' }
  const wscript = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wscript.exe')
  const ok = shell.writeShortcutLink(lnk, 'create', {
    target: wscript,
    args: `"${join(repo, 'scripts', 'orc-launch.vbs')}"`,
    cwd: repo,
    icon: join(repo, 'build', 'icon.ico'),
    iconIndex: 0,
    description: 'Run Claude Code missions'
  })
  if (!ok) throw new Error(`Could not write ${lnk}`)
  return { status: 'created', path: lnk, message: 'Added The ORC to the Desktop.' }
}

/** Linux: a .desktop entry that runs scripts/orc-launch.sh (same contents as scripts/install-shortcut.sh). */
async function createLinux(repo: string, desktop: string): Promise<DesktopShortcutResult> {
  const file = join(desktop, 'the-orc.desktop')
  if (await exists(file)) return { status: 'exists', path: file, message: 'The ORC is already on the Desktop.' }
  const launcher = join(repo, 'scripts', 'orc-launch.sh')
  await chmod(launcher, 0o755).catch(() => {})
  const entry = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=The ORC',
    'Comment=Run Claude Code missions',
    `Exec="${launcher}"`,
    `Icon=${join(repo, 'build', 'icon.png')}`,
    'Terminal=false',
    'Categories=Development;',
    'StartupWMClass=The ORC',
    ''
  ].join('\n')
  await writeFile(file, entry)
  await chmod(file, 0o755)
  // GNOME needs the file marked trusted before it launches on double-click. Best effort.
  await new Promise<void>((done) => execFile('gio', ['set', file, 'metadata::trusted', 'true'], () => done()))
  return { status: 'created', path: file, message: 'Added The ORC to the Desktop.' }
}

/** Puts a launcher for this checkout on the Desktop. Does not overwrite an existing one. */
export async function createDesktopShortcut(): Promise<DesktopShortcutResult> {
  if (process.platform === 'darwin') return { status: 'unsupported', message: "Desktop shortcuts aren't supported on macOS yet; drag the app to the Dock instead." }
  const repo = app.getAppPath()
  const desktop = app.getPath('desktop')
  if (process.platform === 'win32') return createWindows(repo, desktop)
  if (process.platform === 'linux') return createLinux(repo, desktop)
  return { status: 'unsupported', message: `Desktop shortcuts aren't supported on ${process.platform} yet.` }
}

/** Channel: desktop-shortcut:create */
export function registerDesktopShortcutIpc(ipcMain: IpcMain): void {
  ipcMain.handle('desktop-shortcut:create', () => createDesktopShortcut())
}
