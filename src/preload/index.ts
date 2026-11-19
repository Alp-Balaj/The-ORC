import { contextBridge, ipcRenderer } from 'electron'
import type { DiffView, MissionView, SpaceView, StartMissionRequest } from '../shared/types.ts'

function listen<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const fn = (_e: unknown, ...args: unknown[]): void => cb(...(args as A))
  ipcRenderer.on(channel, fn)
  return () => ipcRenderer.off(channel, fn)
}

const api = {
  listMissions: (): Promise<MissionView[]> => ipcRenderer.invoke('missions:list'),
  startMission: (req: StartMissionRequest): Promise<string> =>
    ipcRenderer.invoke('missions:start', req),
  stopMission: (id: string): Promise<void> => ipcRenderer.invoke('missions:stop', id),
  restartMission: (id: string): Promise<void> => ipcRenderer.invoke('missions:restart', id),
  pauseMission: (id: string): Promise<void> => ipcRenderer.invoke('missions:pause', id),
  removeMission: (id: string): Promise<boolean> => ipcRenderer.invoke('missions:remove', id),
  resumeMission: (id: string): Promise<void> => ipcRenderer.invoke('missions:resume', id),
  updateSpace: (root: string, patch: { gateCommand?: string | null; maxLive?: number; vaultDir?: string | null }): Promise<void> => ipcRenderer.invoke('spaces:update', root, patch),
  decideSplit: (id: string, approve: boolean, note: string | null): Promise<void> => ipcRenderer.invoke('missions:decide-split', id, approve, note),
  approveWorker: (id: string, agent: string): Promise<void> => ipcRenderer.invoke('missions:approve-worker', id, agent),
  stopWorker: (id: string, agent: string): Promise<void> => ipcRenderer.invoke('missions:stop-worker', id, agent),
  sendBack: (id: string, agent: string, note: string): Promise<void> => ipcRenderer.invoke('missions:send-back', id, agent, note),
  workerDiff: (id: string, agent: string): Promise<DiffView | null> => ipcRenderer.invoke('missions:worker-diff', id, agent),
  missionDiff: (id: string): Promise<DiffView | null> => ipcRenderer.invoke('missions:diff', id),
  runGate: (id: string): Promise<void> => ipcRenderer.invoke('missions:run-gate', id),
  runVerifier: (id: string): Promise<void> => ipcRenderer.invoke('missions:run-verifier', id),
  mergeToMain: (id: string): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('missions:merge-to-main', id),
  setGateCommand: (root: string, command: string | null): Promise<void> => ipcRenderer.invoke('spaces:set-gate', root, command),
  pickRepo: (): Promise<string | null> => ipcRenderer.invoke('dialog:pick-repo'),
  listSpaces: (): Promise<SpaceView[]> => ipcRenderer.invoke('spaces:list'),
  addSpace: (path: string): Promise<string> => ipcRenderer.invoke('spaces:add', path),
  removeSpace: (root: string): Promise<void> => ipcRenderer.invoke('spaces:remove', root),
  onSpaces: (cb: (s: SpaceView[]) => void) => listen<[SpaceView[]]>('spaces:changed', cb),
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
