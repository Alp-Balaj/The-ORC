export type AgentRole = 'coordinator' | 'worker'

/** working: mid-turn · idle: turn finished · needs-you: waiting on a permission
 *  prompt or a question · done: reported done · exited: process ended. */
export type AgentStatus = 'starting' | 'working' | 'idle' | 'needs-you' | 'done' | 'exited'

export interface AgentView {
  name: string
  sessionName: string
  role: AgentRole
  parent: string | null
  task: string
  status: AgentStatus
  activity: string
  lastInstructionBy: 'you' | 'coordinator' | null
  lastInstructionAt: number | null
  branch: string | null
  cwd: string
  sessionId: string
  terminalId: string
  question: string | null
  doneSummary: string | null
}

export interface MissionView {
  id: string
  name: string
  repoPath: string
  baseBranch: string
  permissionMode: PermissionMode
  agents: AgentView[]
}

export type PermissionMode = 'acceptEdits' | 'auto' | 'bypassPermissions' | 'manual' | 'dontAsk'

export interface StartMissionRequest {
  repoPath: string
  name: string
  permissionMode: PermissionMode
}
