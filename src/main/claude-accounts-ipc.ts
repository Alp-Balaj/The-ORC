import { app, type IpcMain } from 'electron'
import { join } from 'node:path'
import { claudeAccounts } from './claude-accounts.ts'

/** Channels: claude-accounts:list | add | login | cancel-login | submit-code | set-active | rename | remove */
export function registerClaudeAccountsIpc(ipcMain: IpcMain, root = join(app.getPath('userData'), 'claude-accounts')): void {
  claudeAccounts.init(root)
  ipcMain.handle('claude-accounts:list', () => claudeAccounts.list())
  ipcMain.handle('claude-accounts:add', (_e, name: string) => claudeAccounts.add(String(name ?? '')))
  ipcMain.handle('claude-accounts:login', (_e, id: string) => claudeAccounts.login(id))
  ipcMain.handle('claude-accounts:cancel-login', (_e, id: string) => claudeAccounts.cancelLogin(id))
  ipcMain.handle('claude-accounts:submit-code', (_e, id: string, code: string) => claudeAccounts.submitCode(id, String(code ?? '')))
  ipcMain.handle('claude-accounts:set-active', (_e, id: string) => claudeAccounts.setActive(id))
  ipcMain.handle('claude-accounts:rename', (_e, id: string, name: string) => claudeAccounts.rename(id, String(name ?? '')))
  ipcMain.handle('claude-accounts:remove', (_e, id: string) => claudeAccounts.remove(id))
  app.on('before-quit', () => claudeAccounts.shutdown())
}
