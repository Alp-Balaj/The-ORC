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
  /** Fresh tokens this session has used: input + cache writes + output, summed over its
   *  transcript's assistant messages. Cache reads are left out (they would count the same
   *  context again on every turn). */
  tokens: number
  /** Size of the context on the latest turn (input + cache writes + cache reads). */
  contextTokens: number
  startedAt: number
}

/** One line of a mission's feed. "message" is a SendMessage as the sender saw it;
 *  "delivered" is the same message reaching the receiver's next turn. */
export interface FeedEntry {
  id: number
  at: number
  kind: 'spawn' | 'message' | 'delivered' | 'done' | 'question' | 'steer' | 'stopped'
  /** Agent names within the mission (or "you"). */
  from: string
  to: string | null
  text: string
  /** For "message": what Claude Code answered the sender. */
  status?: 'sent' | 'failed'
}

export interface MissionView {
  id: string
  name: string
  repoPath: string
  baseBranch: string
  permissionMode: PermissionMode
  model: string | null
  state: 'running' | 'stopped'
  createdAt: number
  agents: AgentView[]
  feed: FeedEntry[]
  tokens: number
}

/** A repository the user has opened. Missions belong to the space of their repo. */
export interface SpaceView {
  root: string
  name: string
}

export type PermissionMode = 'acceptEdits' | 'auto' | 'bypassPermissions' | 'manual' | 'dontAsk'

export interface StartMissionRequest {
  repoPath: string
  name: string
  permissionMode: PermissionMode
  /** Passed as --model to every session in the mission (e.g. "haiku"). Default: Claude Code's own. */
  model?: string
}
