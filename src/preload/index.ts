import { contextBridge, ipcRenderer } from 'electron'
import type { MissionView, StartMissionRequest } from '../shared/types.ts'

function listen<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const fn = (_e: unknown, ...args: unknown[]): void => cb(...(args as A))
  ipcRenderer.on(channel, fn)
  return () => ipcRenderer.off(channel, fn)
}

const api = {
  listMissions: (): Promise<MissionView[]> => ipcRenderer.invoke('missions:list'),
  startMission: (req: StartMissionRequest): Promise<string> =>
    ipcRenderer.invoke('missions:start', req),
  pickRepo: (): Promise<string | null> => ipcRenderer.invoke('dialog:pick-repo'),
  onMissions: (cb: (m: MissionView[]) => void) => listen<[MissionView[]]>('missions:changed', cb),
  replay: (id: string): Promise<string> => ipcRenderer.invoke('terminal:replay', id),
  write: (id: string, data: string): void => ipcRenderer.send('terminal:write', id, data),
  resize: (id: string, cols: number, rows: number): void =>
    ipcRenderer.send('terminal:resize', id, cols, rows),
  onData: (cb: (id: string, data: string) => void) => listen<[string, string]>('terminal:data', cb),
  onExit: (cb: (id: string, code: number) => void) => listen<[string, number]>('terminal:exit', cb)
}

export type OrcApi = typeof api
contextBridge.exposeInMainWorld('orc', api)
