import { app, shell, type IpcMain } from 'electron'
import { execFile } from 'node:child_process'
import { access, chmod, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { accentIcoBuffer, accentIcon, currentAccentHex } from './icon-color.ts'

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

const run = (cmd: string, args: string[]): Promise<void> => new Promise((done) => execFile(cmd, args, () => done()))

/**
 * Linux: a .desktop entry that runs scripts/orc-launch.sh (same contents as scripts/install-shortcut.sh),
 * written to the app launcher (~/.local/share/applications) and to the Desktop folder when there is one.
 * Re-running rewrites both, so the icon follows the current accent.
 */
async function createLinux(repo: string, desktop: string, accent: string | null): Promise<DesktopShortcutResult> {
  let icon = join(repo, 'build', 'icon.png')
  const img = accent ? accentIcon(accent) : null
  if (accent && img) {
    // Unique file name per accent: launchers cache icons by path.
    const dir = join(app.getPath('userData'), 'shortcut-icons')
    await mkdir(dir, { recursive: true })
    icon = join(dir, `icon-${accent.slice(1).toLowerCase()}.png`)
    await writeFile(icon, img.resize({ width: 256, height: 256, quality: 'best' }).toPNG())
  }
  const launcher = join(repo, 'scripts', 'orc-launch.sh')
  await chmod(launcher, 0o755).catch(() => {})
  const entry = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=The ORC',
    'Comment=Run Claude Code missions',
    `Exec="${launcher}"`,
    `Icon=${icon}`,
    'Terminal=false',
    'Categories=Development;',
    'StartupWMClass=The ORC',
    ''
  ].join('\n')

  const apps = join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'applications')
  const appFile = join(apps, 'the-orc.desktop')
  const hadApp = await exists(appFile)
  await mkdir(apps, { recursive: true })
  await writeFile(appFile, entry)
  await chmod(appFile, 0o755)
  await run('update-desktop-database', [apps])

  // Without a Desktop folder, Electron's 'desktop' path is the home folder: skip it rather than litter ~.
  const deskFile = join(desktop, 'the-orc.desktop')
  const hasDesktop = resolve(desktop) !== resolve(homedir()) && (await exists(desktop))
  const hadDesk = hasDesktop && (await exists(deskFile))
  if (hasDesktop) {
    await writeFile(deskFile, entry)
    await chmod(deskFile, 0o755)
    // GNOME needs the file marked trusted before it launches on double-click. Best effort.
    await run('gio', ['set', deskFile, 'metadata::trusted', 'true'])
  }

  const where = hasDesktop ? 'the app launcher and the Desktop' : 'the app launcher'
  const had = hadApp && (!hasDesktop || hadDesk)
  return had
    ? { status: 'exists', path: appFile, message: `The ORC is already in ${where}; icon updated to the current accent.` }
    : { status: 'created', path: appFile, message: `Added The ORC to ${where}.` }
}

/** Puts a launcher for this checkout on the Desktop (and, on Linux, in the app launcher), in the current accent color. */
export async function createDesktopShortcut(accentHex?: string): Promise<DesktopShortcutResult> {
  const accent = accentHex && /^#[0-9a-f]{6}$/i.test(accentHex) ? accentHex : currentAccentHex()
  if (process.platform === 'darwin') return { status: 'unsupported', message: "Desktop shortcuts aren't supported on macOS yet; drag the app to the Dock instead." }
  const repo = app.getAppPath()
  const desktop = app.getPath('desktop')
  if (process.platform === 'win32') return createWindows(repo, desktop, accent)
  if (process.platform === 'linux') return createLinux(repo, desktop, accent)
  return { status: 'unsupported', message: `Desktop shortcuts aren't supported on ${process.platform} yet.` }
}

/** Channel: desktop-shortcut:create */
export function registerDesktopShortcutIpc(ipcMain: IpcMain): void {
  ipcMain.handle('desktop-shortcut:create', (_e, accent?: string) => createDesktopShortcut(accent))
}
