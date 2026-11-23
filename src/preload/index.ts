import { clipboard, contextBridge, ipcRenderer } from 'electron'
import type { AppRunView, AutopilotPatch, AutopilotView, DiffView, MissionView, PermissionMode, PlanUsageView, QueueView, RoleModels, SpaceView, StartMissionRequest } from '../shared/types.ts'

export type SpacePatch = { gateCommand?: string | null; maxLive?: number; recordsDir?: string | null; runCommand?: string | null; models?: Partial<RoleModels>; usageThreshold?: number; idleStopMinutes?: number; maxParallel?: number; notifications?: boolean }

function listen<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const fn = (_e: unknown, ...args: unknown[]): void => cb(...(args as A))
  ipcRenderer.on(channel, fn)
  return () => ipcRenderer.off(channel, fn)
}

const api = {
  listMissions: (): Promise<MissionView[]> => ipcRenderer.invoke('missions:list'),
  resumedAtLaunch: (): Promise<{ id: string; name: string }[]> => ipcRenderer.invoke('missions:resumed-at-launch'),
  stopResumed: (): Promise<void> => ipcRenderer.invoke('missions:stop-resumed'),
  dismissResumed: (): Promise<void> => ipcRenderer.invoke('missions:dismiss-resumed'),
  startMission: (req: StartMissionRequest): Promise<string> =>
    ipcRenderer.invoke('missions:start', req),
  stopMission: (id: string): Promise<void> => ipcRenderer.invoke('missions:stop', id),
  restartMission: (id: string): Promise<void> => ipcRenderer.invoke('missions:restart', id),
  pauseMission: (id: string): Promise<void> => ipcRenderer.invoke('missions:pause', id),
  removeMission: (id: string): Promise<boolean> => ipcRenderer.invoke('missions:remove', id),
  resumeMission: (id: string): Promise<void> => ipcRenderer.invoke('missions:resume', id),
  updateSpace: (root: string, patch: SpacePatch): Promise<void> => ipcRenderer.invoke('spaces:update', root, patch),
  decideSplit: (id: string, approve: boolean, note: string | null): Promise<void> => ipcRenderer.invoke('missions:decide-split', id, approve, note),
  approveWorker: (id: string, agent: string): Promise<void> => ipcRenderer.invoke('missions:approve-worker', id, agent),
  stopWorker: (id: string, agent: string): Promise<void> => ipcRenderer.invoke('missions:stop-worker', id, agent),
  dismissAgent: (id: string, agent: string): Promise<void> => ipcRenderer.invoke('missions:dismiss-agent', id, agent),
  sendBack: (id: string, agent: string, note: string): Promise<void> => ipcRenderer.invoke('missions:send-back', id, agent, note),
  workerDiff: (id: string, agent: string): Promise<DiffView | null> => ipcRenderer.invoke('missions:worker-diff', id, agent),
  missionDiff: (id: string): Promise<DiffView | null> => ipcRenderer.invoke('missions:diff', id),
  runGate: (id: string): Promise<void> => ipcRenderer.invoke('missions:run-gate', id),
  runVerifier: (id: string): Promise<void> => ipcRenderer.invoke('missions:run-verifier', id),
  /** Integrates a mission into its repo's ORC branch. */
  integrate: (id: string): Promise<{ ok: boolean; message: string; files?: string[] }> => ipcRenderer.invoke('missions:integrate', id),
  /** What Merge to main would bring: main...ORC branch. */
  orcDiff: (repo: string): Promise<DiffView | null> => ipcRenderer.invoke('orc:diff', repo),
  /** Merges the repo's ORC branch into main and clears out the missions now in main. */
  mergeToMain: (repo: string): Promise<{ ok: boolean; message: string; cleared?: number; files?: string[] }> => ipcRenderer.invoke('orc:merge-to-main', repo),
  /** The branch Push to GitHub would push, and its remote (null: none configured). */
  pushTarget: (repo: string): Promise<{ branch: string; remote: string | null }> => ipcRenderer.invoke('orc:push-target', repo),
  /** `git push -u <remote> <main>`: never forced; the human's click only. */
  pushToRemote: (repo: string): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('orc:push', repo),
  setGateCommand: (root: string, command: string | null): Promise<void> => ipcRenderer.invoke('spaces:set-gate', root, command),
  pickRepo: (): Promise<string | null> => ipcRenderer.invoke('dialog:pick-repo'),
  listSpaces: (): Promise<SpaceView[]> => ipcRenderer.invoke('spaces:list'),
  addSpace: (path: string): Promise<string> => ipcRenderer.invoke('spaces:add', path),
  removeSpace: (root: string): Promise<void> => ipcRenderer.invoke('spaces:remove', root),
  onSpaces: (cb: (s: SpaceView[]) => void) => listen<[SpaceView[]]>('spaces:changed', cb),
  runApp: (missionId: string): Promise<void> => ipcRenderer.invoke('app:run', missionId),
  stopApp: (): Promise<void> => ipcRenderer.invoke('app:stop'),
  pendingAppRestore: (): Promise<{ missionId: string; missionName: string } | null> => ipcRenderer.invoke('app:pending-restore'),
  startAppRestore: (): Promise<void> => ipcRenderer.invoke('app:restore-start'),
  dismissAppRestore: (): Promise<void> => ipcRenderer.invoke('app:restore-dismiss'),
  currentApp: (): Promise<AppRunView | null> => ipcRenderer.invoke('app:current'),
  onApp: (cb: (run: AppRunView | null) => void) => listen<[AppRunView | null]>('app:changed', cb),
  onMissions: (cb: (m: MissionView[]) => void) => listen<[MissionView[]]>('missions:changed', cb),
  listQueues: (): Promise<QueueView[]> => ipcRenderer.invoke('queue:list'),
  onQueues: (cb: (q: QueueView[]) => void) => listen<[QueueView[]]>('queue:changed', cb),
  queueAdd: (root: string, title: string, details: string): Promise<void> => ipcRenderer.invoke('queue:add', root, title, details),
  queueUpdate: (root: string, id: string, patch: { title?: string; details?: string }): Promise<void> => ipcRenderer.invoke('queue:update', root, id, patch),
  queueRemove: (root: string, id: string): Promise<void> => ipcRenderer.invoke('queue:remove', root, id),
  /** Every item id of the space, in the new order. */
  queueClear: (root: string, scope: 'done' | 'all'): Promise<void> => ipcRenderer.invoke('queue:clear', root, scope),
  queueReorder: (root: string, ids: string[]): Promise<void> => ipcRenderer.invoke('queue:reorder', root, ids),
  /** Starts or resumes the queue; red flags on the current item are acknowledged. */
  queueStart: (root: string, permissionMode: PermissionMode): Promise<void> => ipcRenderer.invoke('queue:start', root, permissionMode),
  queuePause: (root: string): Promise<void> => ipcRenderer.invoke('queue:pause', root),
  listAutopilot: (): Promise<AutopilotView[]> => ipcRenderer.invoke('autopilot:list'),
  onAutopilot: (cb: (a: AutopilotView[]) => void) => listen<[AutopilotView[]]>('autopilot:changed', cb),
  autopilotSet: (root: string, patch: AutopilotPatch): Promise<void> => ipcRenderer.invoke('autopilot:set', root, patch),
  planUsage: (): Promise<PlanUsageView | null> => ipcRenderer.invoke('usage:get'),
  onPlanUsage: (cb: (u: PlanUsageView | null) => void) => listen<[PlanUsageView | null]>('usage:changed', cb),
  replay: (id: string): Promise<string> => ipcRenderer.invoke('terminal:replay', id),
  copyText: (text: string): void => clipboard.writeText(text),
  /** The mission/agent on screen, so notifications skip what the owner is already looking at. */
  setSelection: (missionId: string | null, terminalId: string | null): void => ipcRenderer.send('ui:selection', missionId, terminalId),
  onNotifySelect: (cb: (missionId: string, terminalId: string) => void) => listen<[string, string]>('notify:select', cb),
  setNativeTheme: (pref: 'light' | 'dark' | 'system'): void => ipcRenderer.send('theme:set-native', pref),
  write: (id: string, data: string): void => ipcRenderer.send('terminal:write', id, data),
  resize: (id: string, cols: number, rows: number): void =>
    ipcRenderer.send('terminal:resize', id, cols, rows),
  onData: (cb: (id: string, data: string) => void) => listen<[string, string]>('terminal:data', cb),
  onExit: (cb: (id: string, code: number) => void) => listen<[string, number]>('terminal:exit', cb)
}

export type OrcApi = typeof api
contextBridge.exposeInMainWorld('orc', api)
