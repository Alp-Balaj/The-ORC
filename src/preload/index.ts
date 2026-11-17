import { contextBridge, ipcRenderer } from 'electron'

const api = {
  startShell: (id: string): Promise<void> => ipcRenderer.invoke('terminal:start-shell', id),
  replay: (id: string): Promise<string> => ipcRenderer.invoke('terminal:replay', id),
  write: (id: string, data: string): void => ipcRenderer.send('terminal:write', id, data),
  resize: (id: string, cols: number, rows: number): void =>
    ipcRenderer.send('terminal:resize', id, cols, rows),
  onData: (cb: (id: string, data: string) => void): (() => void) => {
    const fn = (_e: unknown, id: string, data: string): void => cb(id, data)
    ipcRenderer.on('terminal:data', fn)
    return () => ipcRenderer.off('terminal:data', fn)
  },
  onExit: (cb: (id: string, code: number) => void): (() => void) => {
    const fn = (_e: unknown, id: string, code: number): void => cb(id, code)
    ipcRenderer.on('terminal:exit', fn)
    return () => ipcRenderer.off('terminal:exit', fn)
  }
}

export type OrcApi = typeof api
contextBridge.exposeInMainWorld('orc', api)
