import { app, shell, type IpcMain } from 'electron'
import { execFile } from 'node:child_process'
import { access, chmod, mkdir, writeFile } from 'node:fs/promises'
import { accentIcoBuffer, currentAccentHex } from './icon-color.ts'
import { join } from 'node:path'

export type DesktopShortcutResult = { status: 'created' | 'exists' | 'unsupported'; path?: string; message: string }

const exists = (path: string): Promise<boolean> => access(path).then(() => true, () => false)

/** Windows: a .lnk that runs scripts/orc-launch.vbs (same target as scripts/install-shortcut.ps1). */
async function createWindows(repo: string, desktop: string, accent: string | null): Promise<DesktopShortcutResult> {
  const lnk = join(desktop, 'The ORC.lnk')
  const had = await exists(lnk)
  let icon = join(repo, 'build', 'icon.ico')
  const ico = accent ? accentIcoBuffer(accent) : null
  if (accent && ico) {
    // Unique file name per accent: Windows caches shortcut icons by path.
    const dir = join(app.getPath('userData'), 'shortcut-icons')
    await mkdir(dir, { recursive: true })
    icon = join(dir, `icon-${accent.slice(1).toLowerCase()}.ico`)
    await writeFile(icon, ico)
  }
  const wscript = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wscript.exe')
  const ok = shell.writeShortcutLink(lnk, 'create', {
    target: wscript,
    args: `"${join(repo, 'scripts', 'orc-launch.vbs')}"`,
    cwd: repo,
    icon,
    iconIndex: 0,
    description: 'Run Claude Code missions'
  })
  if (!ok) throw new Error(`Could not write ${lnk}`)
  return had
    ? { status: 'exists', path: lnk, message: 'The ORC is already on the Desktop; icon updated to the current accent.' }
    : { status: 'created', path: lnk, message: 'Added The ORC to the Desktop.' }
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
export async function createDesktopShortcut(accentHex?: string): Promise<DesktopShortcutResult> {
  const accent = accentHex && /^#[0-9a-f]{6}$/i.test(accentHex) ? accentHex : currentAccentHex()
  if (process.platform === 'darwin') return { status: 'unsupported', message: "Desktop shortcuts aren't supported on macOS yet; drag the app to the Dock instead." }
  const repo = app.getAppPath()
  const desktop = app.getPath('desktop')
  if (process.platform === 'win32') return createWindows(repo, desktop, accent)
  if (process.platform === 'linux') return createLinux(repo, desktop)
  return { status: 'unsupported', message: `Desktop shortcuts aren't supported on ${process.platform} yet.` }
}

/** Channel: desktop-shortcut:create */
export function registerDesktopShortcutIpc(ipcMain: IpcMain): void {
  ipcMain.handle('desktop-shortcut:create', (_e, accent?: string) => createDesktopShortcut(accent))
}
