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
  /** 'you' for the human, otherwise the sending session's name ('coordinator' in old saved state). */
  lastInstructionBy: string | null
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
  /** How its process ended: "crashed" = exited non-zero on its own (not stopped by you or the
   *  app, not after report_done); "clean" = any other exit; null/absent while it runs. */
  exitKind?: 'clean' | 'crashed' | null
  /** Exit code of a crashed process. */
  exitCode?: number | null
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
  /** True only for the transient placeholder while the gate command runs. */
  running?: boolean
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
  /** Resolved model per role for this mission (defaults < space < mission). */
  models: RoleModels
  /** The owner's branch Merge to main brings the ORC branch into (baseBranch is the ORC branch,
   *  or, for missions started before it existed, main or a stacked mission's integration branch). */
  mainBranch: string
  /** Set when this mission was started by a space's backlog queue. */
  queueItemId: string | null
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
  /** Integrated into the repo's ORC branch: at which commit there, from which integration commit
   *  (newer work merged into the mission since is not on the ORC branch yet). */
  integrated: IntegratedView | null
  /** The last integration into the ORC branch that failed (a conflict), until one succeeds. */
  integrateError: { message: string; files: string[]; at: number } | null
  /** An integration into the ORC branch is running (a merge agent may be resolving a conflict). */
  integrating: boolean
  paused: boolean
}

export interface IntegratedView {
  commit: string
  at: number
  integrationCommit: string | null
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
  /** Per-role model overrides for this space (missing role: DefaultRoleModels). */
  models: Partial<RoleModels>
  /** Plan usage % (5-hour or weekly) at which this space's queue pauses. Default 80. */
  usageThreshold: number
  /** Minutes a finished, merged lead may sit idle before The ORC stops it. 0 = off. Default 15. */
  idleStopMinutes: number
  /** Most backlog-queue items running at once (1-10). 1 = one at a time, stacked. Default 2. */
  maxParallel: number
  /** Desktop notifications and the needs-you badge for this space's missions. Default on. */
  notifications: boolean
  /** A gate command guessed from the repo (e.g. "pnpm typecheck"), shown when gateCommand is null. */
  suggestedGate: string | null
  /** Onboarding finished for this repo (epoch ms), or null: The ORC has not enrolled it yet.
   *  Spaces saved before onboarding existed count as enrolled. */
  enrolledAt: number | null
}

/** What onboarding found in a repo (read-only scan, `onboarding:scan`). */
export interface EnrollmentScan {
  root: string
  name: string
  isGitRepo: boolean
  /** Checked-out branch, null when detached or not a repo. */
  branch: string | null
  /** origin's default branch, else main/master if present, else null. */
  defaultBranch: string | null
  /** Changed files from `git status --porcelain` (staged, unstaged and untracked). */
  dirtyFiles: string[]
  hasCommits: boolean
  /** 'pnpm' | 'npm' | 'yarn' | 'bun' | 'cargo' | 'go' | 'pip' | 'uv' ... or null if unknown. */
  packageManager: string | null
  hasClaudeMd: boolean
  hasClaudeDir: boolean
  /** Which of .claude/settings.json and .claude/settings.local.json exist. */
  claudeSettings: string[]
  /** Suggested gate command, if any. */
  suggestedGate: string | null
  /** Git-write rules The ORC puts in permissions.deny of every session (DeniedGitWrites). */
  denyRules: string[]
  /** Permission mode the main session always uses. */
  mainPermissionMode: PermissionMode
  /** Default mode the new-mission form starts with. */
  missionPermissionMode: PermissionMode
}

/** Who a model setting applies to. lead = team leads; subagent = the leads' Agent-tool
 *  subagents (CLAUDE_CODE_SUBAGENT_MODEL); advisor = Claude Code's server-side advisor
 *  (`advisorModel` setting) for every session; verifier = the Verifier's claude -p. */
export type ModelRole = 'coordinator' | 'lead' | 'subagent' | 'advisor' | 'verifier'
/** null: Claude Code's own default (for advisor: no advisor). */
export type RoleModels = Record<ModelRole, string | null>
export const ModelRoles: ModelRole[] = ['coordinator', 'lead', 'subagent', 'advisor', 'verifier']
/** Owner's defaults (2026-11-22), chosen to save subscription usage. */
export const DefaultRoleModels: RoleModels = { coordinator: 'sonnet', lead: 'sonnet', subagent: 'haiku', advisor: 'fable', verifier: 'sonnet' }

/** One backlog task. Each becomes its own mission (stacked on the previous one only when maxParallel is 1). */
export interface QueueItem {
  id: string
  title: string
  details: string
  /** queued: waiting · running: its mission is underway · done: verified, queue moved on ·
   *  paused: a red flag stopped the queue on this item (see reason). */
  status: 'queued' | 'running' | 'done' | 'paused'
  missionId: string | null
  missionName: string | null
  reason: string | null
  createdAt: number
}

/** A space's backlog queue. `running` = the owner started it and it isn't paused. */
export interface QueueView {
  root: string
  running: boolean
  /** Why the queue is paused (null when running, or never started). */
  pausedReason: string | null
  /** Paused by the plan-usage budget: resumes on its own when the 5-hour window resets. */
  pausedByUsage: boolean
  permissionMode: PermissionMode
  items: QueueItem[]
}

/** The owner's plan usage, from Claude Code's status-line input (`rate_limits`). */
export interface PlanUsageWindow {
  usedPercentage: number
  /** Epoch ms. */
  resetsAt: number | null
}
export interface PlanUsageView {
  fiveHour: PlanUsageWindow | null
  sevenDay: PlanUsageWindow | null
  at: number
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
  /** Legacy/tests: this model for every role, and no advisor. Wins over `models`. */
  model?: string
  /** Per-role overrides for this mission, over the space's and the defaults. */
  models?: Partial<RoleModels>
  /** Default: no check. */
  gating?: Gating
  /** Branch to base the mission on. Default: the repo's ORC branch (created from the checkout's branch). */
  baseBranch?: string
  /** Branch Merge to main targets. Default: the checkout's branch. */
  mainBranch?: string
  /** Typed into the coordinator as its first prompt, and kept as the mission's brief. */
  brief?: string
  queueItemId?: string
}

/** Workers shown on the cards and the tree. An exited worker is removed: always once you
 *  dismissed it or it was shut down on its own, and while the mission runs whenever it exited.
 *  A stopped mission keeps the workers Stop ended (Restart brings them back). A worker whose
 *  diff waits for your review stays, since its card is where you review it; one left in a
 *  conflict stays until you dismiss it. The coordinator always stays. */
/** The failure to put in the banner under the header, most severe first: a crashed agent, a
 *  merge conflict, then a failed gate. Null when nothing failed. */
export type Failure =
  | { kind: 'crash'; agent: AgentView; text: string }
  | { kind: 'conflict'; agent: AgentView; text: string }
  | { kind: 'gate'; text: string }

export function missionFailure(m: MissionView): Failure | null {
  const crashed = m.agents.filter((a) => a.exitKind === 'crashed' && !a.dismissed).at(-1)
  if (crashed) return { kind: 'crash', agent: crashed, text: `${crashed.name} crashed${crashed.exitCode != null ? ` (exit ${crashed.exitCode})` : ''}: its session ended unexpectedly` }
  const conflict = m.agents.find((a) => a.merge === 'conflict' && a.status !== 'exited') ?? m.agents.find((a) => a.merge === 'conflict')
  if (conflict) return { kind: 'conflict', agent: conflict, text: `${conflict.name} conflicts with merged work${conflict.conflictFiles.length ? ` in ${conflict.conflictFiles.length} file${conflict.conflictFiles.length === 1 ? '' : 's'}` : ''}` }
  if (m.gate && !m.gate.ok && !m.gate.running && !m.mergedToMain) return { kind: 'gate', text: `The gate failed (exit ${m.gate.exitCode}): ${m.gate.command}` }
  return null
}

export function shownAgents(m: MissionView): AgentView[] {
  return m.agents.filter((a) => {
    if (a.role !== 'worker' || a.status !== 'exited' || a.merge === 'review') return true
    if (a.dismissed) return false
    if (a.exitKind === 'crashed') return true
    if (a.merge === 'conflict') return true
    return !(a.shutDown || m.state === 'running')
  })
}

/** Autopilot for one space: when the queue runs empty, a read-only discovery session adds new tasks. */
export interface AutopilotView {
  root: string
  /** Per-space switch. Default off. */
  enabled: boolean
  /** Most tasks one discovery round may add (1-10). Default 5. */
  maxTasks: number
  /** Stop after this many rounds in a row that found nothing (1-10). Default 2. */
  maxEmptyRounds: number
  /** off · idle (waiting for the queue to run empty) · discovering · waiting (queue busy or paused) ·
   *  usage (paused by the plan-usage budget) · stopped (too many empty rounds, or a failure). */
  state: 'off' | 'idle' | 'discovering' | 'waiting' | 'usage' | 'stopped'
  /** One line for the UI, e.g. "Discovering: round 3" or "Stopped: 2 rounds found nothing". */
  status: string
  round: number
  emptyRounds: number
}
export type AutopilotPatch = { enabled?: boolean; maxTasks?: number; maxEmptyRounds?: number }

/** The connected GitHub account (via the `gh` CLI; no token ever reaches the app). */
export type GithubAccountView = {
  state: 'missing' | 'disconnected' | 'connecting' | 'connected'
  user: string | null
  /** While connecting: the one-time code gh printed (null until it appears) and where to enter it. */
  connecting: { code: string | null; url: string } | null
  error: string | null
}

/** A space's "main session": a Claude Code session above that repo's missions (not a mission itself).
 *  There is one per space. `off` = not started (or stopped by the owner); the others mirror an agent's status. */
export const MainSessionTerminalPrefix = 'orc-main:'
/** Stable short id of a repo, used in the main session's terminal id, session name and state file. */
export function mainSessionKey(repoPath: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < repoPath.length; i++) {
    const c = repoPath.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}
export const mainSessionTerminalId = (repoPath: string): string => MainSessionTerminalPrefix + mainSessionKey(repoPath)
export const isMainSessionTerminal = (id: string): boolean => id.startsWith(MainSessionTerminalPrefix)
export interface MainSessionView {
  /** The space (repo root) this main session oversees. */
  repoPath: string
  /** The space's name. */
  repoName: string
  terminalId: string
  sessionName: string
  status: 'off' | 'starting' | 'idle' | 'working' | 'needs-you' | 'exited'
  /** One line, e.g. "thinking" or "needs your permission". */
  activity: string
}
