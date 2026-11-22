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
  /** Where this worker's work stands in git (null for the coordinator, or before report_done). */
  merge: 'committed' | 'review' | 'merged' | 'conflict' | 'nothing' | null
  /** Conflicting files when merge is "conflict". */
  conflictFiles: string[]
  /** Shut down on its own (Stop on its card, or stop_agent), not by stopping the mission:
   *  restarting the mission leaves it down. */
  shutDown?: boolean
  /** Removed from the cards and tree with its X. Cleared if the session is brought back. */
  dismissed?: boolean
}

/** One line of a mission's feed. "message" is a SendMessage as the sender saw it;
 *  "delivered" is the same message reaching the receiver's next turn. */
export interface FeedEntry {
  id: number
  at: number
  kind: 'spawn' | 'message' | 'delivered' | 'done' | 'question' | 'steer' | 'stopped' | 'split' | 'commit' | 'merge' | 'conflict' | 'gate' | 'verifier' | 'main' | 'orc'
  /** Agent names within the mission (or "you"). */
  from: string
  to: string | null
  text: string
  /** For "message": what Claude Code answered the sender. */
  status?: 'sent' | 'failed' | 'ok'
}

/** Checkpointed: every worker's diff waits for your review before it merges.
 *  Plan check: the coordinator proposes a split you approve; then merges are automatic.
 *  No check: merges are automatic. In every mode, Merge to main is your click. */
export type Gating = 'checkpointed' | 'plan' | 'none'

export interface SplitView {
  status: 'pending' | 'approved' | 'rejected'
  summary: string
  workers: { name: string; task: string }[]
  at: number
  note: string | null
}

export interface GateView {
  command: string
  ok: boolean
  exitCode: number | null
  output: string
  at: number
}

export interface VerifierView {
  status: 'running' | 'done' | 'failed'
  report: string
  /** sha256 of the pinned prompt template, and of the full prompt sent. */
  templateHash: string
  promptHash: string
  at: number
  /** Integration commit the report is about; stale when integration has moved since. */
  integrationCommit: string | null
}

export interface DiffView {
  base: string
  head: string
  files: { path: string; added: number; removed: number }[]
  patch: string
  commits: number
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
  gating: Gating
  split: SplitView | null
  /** Workers merged into integration/<mission>, in order. */
  merged: string[]
  integrationCommit: string | null
  gate: GateView | null
  verifier: VerifierView | null
  mergedToMain: { commit: string; at: number } | null
  paused: boolean
}

/** A repository the user has opened. Missions belong to the space of their repo. */
export interface SpaceView {
  root: string
  name: string
  /** Shell command run on the merged result (e.g. "pnpm test"). Null: no gate. */
  gateCommand: string | null
  /** Most live agents across this space's missions. */
  maxLive: number
  /** A folder for mission records chosen in the space settings. Null: the default folder. */
  recordsDir: string | null
  /** Where this space's mission records actually go (recordsDir, or the default under the
   *  app's data folder). */
  recordsPath: string
  /** Shell command that runs the app being built (e.g. "pnpm dev"), from a mission's
   *  integration worktree. Null: no Run app. */
  runCommand: string | null
}

/** The app being built, running from one mission's integration worktree. One at a time. */
export interface AppRunView {
  missionId: string
  missionName: string
  terminalId: string
  command: string
  cwd: string
  status: 'running' | 'exited'
  exitCode: number | null
  startedAt: number
}

export type PermissionMode = 'acceptEdits' | 'auto' | 'bypassPermissions' | 'manual' | 'dontAsk'

export interface StartMissionRequest {
  repoPath: string
  name: string
  permissionMode: PermissionMode
  /** Passed as --model to every session in the mission (e.g. "haiku"). Default: Claude Code's own. */
  model?: string
  /** Default: no check. */
  gating?: Gating
}

/** Workers shown on the cards and the tree. An exited worker is removed: always once you
 *  dismissed it or it was shut down on its own, and while the mission runs whenever it exited.
 *  A stopped mission keeps the workers Stop ended (Restart brings them back). A worker whose
 *  diff waits for your review stays, since its card is where you review it; one left in a
 *  conflict stays until you dismiss it. The coordinator always stays. */
export function shownAgents(m: MissionView): AgentView[] {
  return m.agents.filter((a) => {
    if (a.role !== 'worker' || a.status !== 'exited' || a.merge === 'review') return true
    if (a.dismissed) return false
    if (a.merge === 'conflict') return true
    return !(a.shutDown || m.state === 'running')
  })
}
