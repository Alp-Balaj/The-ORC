import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DefaultRoleModels, ModelRoles, type AgentView, type DiffView, type FeedEntry, type GateView, type Gating, type IntegratedView, type MissionView, type RoleModels, type SplitView, type StartMissionRequest, type VerifierView } from '../shared/types.ts'
import { claudeAccounts } from './claude-accounts.ts'
import { claudeArgs, coordinatorPrompt, ownerStatusLine, mergerPrompt, orcMergerPrompt, sessionEnv, workerPrompt } from './claude-launch.ts'
import type { ControlHandlers, HookEvent } from './control-server.ts'
import * as gitOps from './git-worktrees.ts'
import type { TerminalHost } from './terminals.ts'
import { TranscriptTally } from './tokens.ts'
import * as missionGit from './mission-git.ts'
import { runVerifier, templateHash } from './verifier.ts'
import { appendRecord, pastRecords, recordPath } from './records.ts'

interface Agent extends AgentView {
  token: string
  missionId: string
  /** Why the agent is needs-you: a permission prompt clears when the tool runs or the
   *  session goes idle; a question (ask_human) clears only when a new turn starts. */
  waitingOn: 'permission' | 'question' | null
  /** Consecutive `claude agents` polls that saw this session idle while we thought it busy. */
  idlePolls: number
  tally: TranscriptTally | null
  /** Notes for this agent, delivered as hook additionalContext on its next turn or tool call. */
  notes: string[]
  /** Between UserPromptSubmit and Stop. Status can say "done" while the turn is still running
   *  (report_done is called mid-turn), so delivery checks this, not the status. */
  inTurn: boolean
  /** The claude process, for orphan checks after a crash. */
  pid: number | null
  turnIdlePolls?: number
  /** Last hook event, prompt, delivered message or human input: for the idle auto-stop. */
  lastActivityAt: number
  /** Last time the human typed to it. */
  lastHumanAt: number | null
  /** An ask_human question waiting for the human's answer (their next prompt to it). */
  pendingQuestion: string | null
  /** Set on a merge agent: the worker whose conflicted merge it resolves. */
  mergerFor?: string
}

export interface SavedState {
  version: 1
  savedAt: number
  /** models/mainBranch/queueItemId are missing in states saved before 2026-11-22 (which had `model`). */
  missions: (Omit<Mission, 'agents' | 'held' | 'models' | 'mainBranch' | 'queueItemId' | 'integrated' | 'integrateError'> & {
    integrated?: Mission['integrated']
    integrateError?: Mission['integrateError']
    models?: RoleModels
    mainBranch?: string
    queueItemId?: string | null
    model?: string | null
    agents: (AgentView & { transcriptPath: string | null; pid: number | null; notes: string[]; pendingQuestion?: string | null })[] })[]
}

interface MergerState {
  worker: string
  agent: string
  files: string[]
  attempts: number
  /** Workers whose conflict overlaps `files`: retried once this merge lands or fails. */
  queue: string[]
  /** How many times this worker's merge raced another landing and restarted. */
  tries: number
  /** ORC-branch merges only: resolves the pending integrate() result. */
  onDone?: (r: IntegrateOutcome) => void
  integrationCommit?: string | null
}

export interface IntegrateOutcome { ok: boolean; message: string; files?: string[]; pending?: boolean }

interface Mission {
  id: string
  name: string
  repoPath: string
  baseBranch: string
  permissionMode: StartMissionRequest['permissionMode']
  models: RoleModels
  /** The owner's branch Merge to main brings the ORC branch into. */
  mainBranch: string
  queueItemId: string | null
  state: 'running' | 'stopped'
  createdAt: number
  agents: Map<string, Agent>
  feed: FeedEntry[]
  gating: Gating
  split: SplitView | null
  merged: string[]
  integrationCommit: string | null
  gate: GateView | null
  verifier: VerifierView | null
  mergedToMain: { commit: string; at: number } | null
  integrated: IntegratedView | null
  integrateError: { message: string; files: string[]; at: number } | null
  /** The human's first prompt to the coordinator: what the Verifier checks against. */
  brief: string | null
  /** Pause mission: no spawns, merges or deliveries; mid-turn agents were sent Esc. */
  paused: boolean
  /** Merges held while paused (agent names). */
  held: string[]
  /** Its record note has been started (brief written). */
  recorded?: boolean
}

/** Feed entries kept per mission (every change resends the views). */
const MaxFeed = 200

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'mission'

const oneLine = (s: string, max = 160): string => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function describeTool(name: string | undefined, input: Record<string, unknown> | undefined): string {
  if (!name) return ''
  const pick = (k: string): string | undefined =>
    typeof input?.[k] === 'string' ? (input[k] as string) : undefined
  const file = pick('file_path') ?? pick('path') ?? pick('notebook_path')
  if (file) return `${name} ${file.split(/[\\/]/).slice(-2).join('/')}`
  const cmd = pick('command')
  if (cmd) return `${name}: ${cmd.slice(0, 60)}`
  const to = pick('to')
  if (name === 'SendMessage' && to) return `message → ${to.split('/').pop()}`
  if (name.startsWith('mcp__orc__')) return name.replace('mcp__orc__', 'orc: ')
  return name
}

/** `<cross-session-message from="…" from-name="mission/agent" …>body</cross-session-message>` */
function parseCrossSession(prompt: string | undefined): { from: string; body: string } | null {
  const m = /<cross-session-message[^>]*from-name="([^"]+)"[^>]*>([\s\S]*?)(<\/cross-session-message>|$)/.exec(prompt ?? '')
  return m ? { from: m[1], body: m[2] } : null
}

/** Tags Claude Code wraps around prompts it submits itself (not typed by the human). */
const SystemTags = ['task-notification', 'system-reminder', 'cross-session-message', 'local-command-stdout', 'command-message', 'command-name', 'command-args']

/** A prompt Claude Code generated (a subagent's task notification, system reminders, a
 *  cross-session message, slash-command echoes): nothing human-typed is left once those
 *  tag blocks are stripped. */
export function isSystemPrompt(prompt: string | undefined): boolean {
  const p = (prompt ?? '').trim()
  if (!p) return false
  if (p.startsWith('<task-notification')) return true
  let rest = p
  for (const t of SystemTags) rest = rest.replace(new RegExp(`<${t}(\\s[^>]*)?>[\\s\\S]*?(</${t}>|$)`, 'g'), '')
  return rest.trim() === ''
}

export type Launcher = (args: string[]) => { command: string; args: string[] }

/** Owns missions and their agents: launches sessions, maps tokens to agents,
 *  turns hook events into status and a feed, and counts tokens. */
export class Missions implements ControlHandlers {
  private readonly missions = new Map<string, Mission>()
  private readonly byToken = new Map<string, Agent>()
  private readonly byTerminal = new Map<string, Agent>()
  private controlPort = 0
  private feedSeq = 0
  private emitTimer: ReturnType<typeof setTimeout> | null = null
  /** The last views sent to the renderer, serialized: an identical update is not sent again. */
  private lastViews = ''
  /** Most agents one mission may have, coordinator included (M4 makes this per space). */
  maxAgentsPerMission = 8
  /** How a session is started. Tests swap in a fake command. */
  launcher: Launcher = (args) => ({ command: 'claude', args })
  /** Git operations. Tests swap in fakes. */
  git: Pick<typeof gitOps, 'addWorktree' | 'branchesUnder' | 'currentBranch' | 'repoRoot'> &
    Pick<typeof missionGit, 'commitAll' | 'ensureIntegration' | 'mergeIntoIntegration' | 'runGate' | 'combinedDiff' | 'ensureOrcBranch' | 'integrateIntoOrc' | 'mergeOrcToMain' | 'orcDiff' | 'cleanupMission' | 'branchDiff' | 'prepareConflict' | 'startConflictMerge' | 'landMerge' | 'concludeMerge' | 'discardMerge' | 'startOrcConflictMerge' | 'commitOrcMerge' | 'landOrcMerge'> = { ...gitOps, ...missionGit }

  private readonly terminals: TerminalHost
  private readonly changed: (missions: MissionView[]) => void

  constructor(terminals: TerminalHost, changed: (missions: MissionView[]) => void) {
    this.terminals = terminals
    this.changed = changed
    setInterval(() => this.checkIdleStops(), 60_000).unref?.()
  }

  /** Minutes a finished, merged lead may sit idle before The ORC stops it (0 = never).
   *  index.ts wires this to Spaces. */
  idleStopMinutesFor: (repo: string) => number = () => 0

  /** Stops leads whose work is reported and merged and that have sat idle for the space's
   *  idle-stop minutes, the way stop_agent does. Never the coordinator. */
  checkIdleStops(now = Date.now()): void {
    for (const m of this.missions.values()) {
      if (m.state !== 'running' || m.paused) continue
      const minutes = this.idleStopMinutesFor(m.repoPath)
      if (!(minutes > 0)) continue
      const window = minutes * 60_000
      for (const a of m.agents.values()) {
        if (a.role !== 'worker' || a.shutDown || a.status !== 'done' || a.inTurn) continue
        if (a.merge !== 'merged' && a.merge !== 'nothing') continue
        if (now - a.lastActivityAt < window) continue
        if (a.lastHumanAt !== null && now - a.lastHumanAt < window) continue
        if ([...m.agents.values()].some((x) => x.parent === a.name && x.status !== 'exited')) continue
        this.endAgent(m, a, 'orc', `stopped: idle ${minutes} min after its work was merged`)
      }
    }
  }

  /** Who is calling an MCP tool: its role, space and mission. */
  callerInfo(terminalId: string): { role: 'coordinator' | 'worker'; repoPath: string; missionName: string; missionId: string } | null {
    const a = this.byTerminal.get(terminalId)
    const m = a ? this.missions.get(a.missionId) : undefined
    if (!a || !m) return null
    return { role: a.role, repoPath: m.repoPath, missionName: m.name, missionId: m.id }
  }

  setControlPort(port: number): void {
    this.controlPort = port
  }

  views(): MissionView[] {
    return [...this.missions.values()].map((m) => {
      const agents = [...m.agents.values()].map(agentView)
      return {
        id: m.id,
        name: m.name,
        repoPath: m.repoPath,
        baseBranch: m.baseBranch,
        permissionMode: m.permissionMode,
        models: m.models,
        mainBranch: m.mainBranch,
        queueItemId: m.queueItemId,
        state: m.state,
        createdAt: m.createdAt,
        agents,
        feed: m.feed,
        tokens: agents.reduce((n, a) => n + a.tokens, 0),
        gating: m.gating,
        split: m.split,
        merged: m.merged,
        integrationCommit: m.integrationCommit,
        gate: m.gate,
        verifier: m.verifier,
        mergedToMain: m.mergedToMain,
        integrated: m.integrated,
        integrateError: m.integrateError,
        integrating: this.integrating.has(m.id),
        paused: m.paused
      }
    })
  }

  async startMission(req: StartMissionRequest): Promise<string> {
    const repo = await this.git.repoRoot(req.repoPath)
    const name = slug(req.name)
    // Session names are "<mission>/<agent>" and SendMessage addresses by name, machine-wide:
    // a mission name must be unique across every space, not just this repo.
    if ([...this.missions.values()].some((m) => m.name === name)) {
      throw new Error(`a mission named "${name}" already exists. Pick another name.`)
    }
    if (this.liveIn(repo) >= this.liveLimitFor(repo)) {
      throw new Error(`this space already has ${this.liveIn(repo)} live agents, the most allowed (${this.liveLimitFor(repo)}). Stop or finish a mission first.`)
    }
    if ((await this.git.branchesUnder(repo, `orc/${name}/`)).length > 0) {
      throw new Error(`a mission named "${name}" ran in this repository before (its orc/${name}/… branches still exist). Pick another name.`)
    }
    // Every mission starts from the repo's ORC branch, so it builds on the work integrated so far.
    const mainBranch = req.mainBranch ?? (await this.git.currentBranch(repo))
    const baseBranch = req.baseBranch ?? (await this.git.ensureOrcBranch(repo, mainBranch), missionGit.OrcBranch)
    const mission: Mission = {
      id: randomUUID(),
      name,
      repoPath: repo,
      baseBranch,
      permissionMode: req.permissionMode,
      models: resolveModels(this.spaceModelsFor(repo), req),
      mainBranch,
      queueItemId: req.queueItemId ?? null,
      state: 'running',
      createdAt: Date.now(),
      agents: new Map(),
      feed: [],
      gating: req.gating ?? 'none',
      split: null,
      merged: [],
      integrationCommit: null,
      gate: null,
      verifier: null,
      mergedToMain: null,
      integrated: null,
      integrateError: null,
      brief: req.brief?.trim() || null,
      paused: false,
      held: []
    }
    this.missions.set(mission.id, mission)
    const sessionName = `${name}/coordinator`
    try {
      this.launch(mission, {
        name: 'coordinator',
        sessionName,
        role: 'coordinator',
        parent: null,
        task: '',
        cwd: repo,
        branch: mission.baseBranch,
        systemPrompt: coordinatorPrompt(name, sessionName, repo, mission.gating, this.pastRecordsFor(mission)),
        // Already the brief, so its UserPromptSubmit (counted as the human's) doesn't replace it.
        firstPrompt: mission.brief ?? undefined
      })
    } catch (err) {
      // The coordinator never started: forget the mission so the name can be used again.
      for (const a of mission.agents.values()) {
        this.byTerminal.delete(a.terminalId)
        if (a.token) this.byToken.delete(a.token)
      }
      this.missions.delete(mission.id)
      this.emit()
      throw err
    }
    return mission.id
  }

  /** Forgets a stopped mission (its git branches and worktrees are left alone). */
  removeMission(id: string): boolean {
    const m = this.missions.get(id)
    if (!m || m.state !== 'stopped') return false
    for (const a of m.agents.values()) {
      this.byTerminal.delete(a.terminalId)
      if (a.token) this.byToken.delete(a.token)
    }
    this.missions.delete(id)
    this.emit()
    return true
  }

  /** Kills every session of the mission. Worktrees and branches stay. */
  stopMission(id: string): void {
    const m = this.missions.get(id)
    if (!m || m.state === 'stopped') return
    m.state = 'stopped'
    for (const a of m.agents.values()) {
      this.terminals.kill(a.terminalId)
      if (a.status !== 'done') {
        a.status = 'exited'
        a.activity = 'stopped'
      }
    }
    this.feed(m, { kind: 'stopped', from: 'you', to: null, text: 'Mission stopped. Every session was ended; worktrees are kept.' })
    // A merge agent for the ORC branch died with it: refuse the pending integration.
    const orc = this.mergers.get(id)?.get(missionGit.OrcMergeKey)
    if (orc) {
      const agent = m.agents.get(orc.agent)
      if (agent) this.gitWork = this.gitWork.then(() => this.orcMergerFailed(m, agent, orc, 'was stopped with the mission')).catch(() => {})
    }
  }

  // ControlHandlers ---------------------------------------------------------

  agentForToken(token: string): string | null {
    return this.byToken.get(token)?.terminalId ?? null
  }

  async spawnAgent(callerTerminal: string, rawName: string, task: string): Promise<string> {
    const caller = this.byTerminal.get(callerTerminal)
    if (!caller) throw new Error('unknown caller')
    const mission = this.missions.get(caller.missionId)!
    if (mission.state === 'stopped') return 'This mission is stopped. No new workers can start.'
    if (mission.paused) return 'The human paused this mission. Do not start workers; end your turn and wait.'
    const live = this.liveIn(mission.repoPath)
    const limit = this.liveLimitFor(mission.repoPath)
    if (live >= limit) {
      return `This space already has ${live} live agents, the most allowed (${limit}). Wait for a worker to finish, or reuse one by messaging it.`
    }
    // Plan check is enforced here, not only asked for in the prompt.
    if (mission.gating === 'plan' && mission.split?.status !== 'approved') {
      return mission.split?.status === 'pending'
        ? 'Your split is waiting for the human\'s approval in The ORC. Do not spawn yet; end your turn. You will get a message when they decide.'
        : 'This mission uses plan check: call propose_split with your proposed workers first, then end your turn and wait for the human\'s approval.'
    }
    const name = slug(rawName)
    if (mission.agents.has(name)) {
      return `A worker named "${name}" already exists in this mission. Pick another name.`
    }
    // Stopped workers don't count: shutting one down makes room for another.
    const running = [...mission.agents.values()].filter((x) => x.status !== 'exited').length
    if (running >= this.maxAgentsPerMission) {
      return `This mission already has ${running} running agents, the most allowed. Reuse an existing worker by messaging it, or stop a finished one with stop_agent.`
    }
    let wt: { path: string; branch: string }
    try {
      wt = await this.git.addWorktree(mission.repoPath, mission.name, name, mission.baseBranch)
    } catch (err) {
      this.orcNote(mission, `could not create a worktree for ${name}: ${String((err as Error).message ?? err)}`)
      return `The ORC could not create a worktree for "${name}": ${oneLine(String((err as Error).message ?? err), 300)}. Pick another name or tell the human.`
    }
    const sessionName = `${mission.name}/${name}`
    this.launch(mission, {
      name,
      sessionName,
      role: 'worker',
      parent: caller.name,
      task,
      cwd: wt.path,
      branch: wt.branch,
      systemPrompt: workerPrompt(mission.name, sessionName, caller.sessionName),
      firstPrompt: task
    })
    this.feed(mission, { kind: 'spawn', from: caller.name, to: name, text: oneLine(task) })
    return (
      `Started worker "${sessionName}" on branch ${wt.branch}. ` +
      `It will report to you with SendMessage; message it by that name.`
    )
  }

  reportDone(callerTerminal: string, summary: string): void {
    const a = this.byTerminal.get(callerTerminal)
    this.update(callerTerminal, { status: 'done', activity: 'reported done', doneSummary: summary, question: null, waitingOn: null })
    if (!a) return
    const mission = this.missions.get(a.missionId)!
    this.feed(mission, { kind: 'done', from: a.name, to: a.parent, text: oneLine(summary) })
    if (a.mergerFor) {
      this.gitWork = this.gitWork.then(() => this.finishMerger(mission, a, summary)).catch((err) => this.orcNote(mission, `merge error: ${String(err)}`))
      return
    }
    if (a.role === 'worker') this.record(mission, `Report from ${a.name}`, summary)
    // The app commits for the agent (agents never commit). Runs after the tool replies.
    if (a.role === 'worker') this.gitWork = this.gitWork.then(() => this.afterDone(mission, a, summary)).catch((err) => this.orcNote(mission, `git error after ${a.name}'s report: ${String(err)}`))
  }

  /** Chain of git work after reports, so tests can await it. */
  gitWork: Promise<void> = Promise.resolve()

  proposeSplit(callerTerminal: string, summary: string, workers: { name: string; task: string }[]): string {
    const a = this.byTerminal.get(callerTerminal)
    if (!a) throw new Error('unknown caller')
    const mission = this.missions.get(a.missionId)!
    if (a.role !== 'coordinator') return 'Only the coordinator proposes the split.'
    if (mission.gating !== 'plan') return 'This mission does not use plan check. Spawn the workers directly with spawn_agent.'
    if (mission.split?.status === 'approved') return 'A split is already approved. Spawn its workers with spawn_agent.'
    mission.split = { status: 'pending', summary, workers: workers.map((w) => ({ name: slug(w.name), task: w.task })), at: Date.now(), note: null }
    this.feed(mission, { kind: 'split', from: a.name, to: 'you', text: oneLine(`${summary} (${workers.length} workers: ${workers.map((w) => w.name).join(', ')})`) })
    return 'Pending: the human reviews your split in The ORC. End your turn now and do not spawn anything. You will receive a message starting with [The ORC] when they approve or reject it.'
  }

  /** orc MCP `integrate_mission`: the coordinator integrates its own mission into the ORC branch. */
  async integrateMission(callerTerminal: string): Promise<string> {
    const a = this.byTerminal.get(callerTerminal)
    if (!a) throw new Error('unknown caller')
    if (a.role !== 'coordinator') return 'Only the coordinator integrates the mission.'
    const mission = this.missions.get(a.missionId)!
    const busy = [...mission.agents.values()].filter((x) => x.role === 'worker' && !x.mergerFor && x.merge !== 'merged' && x.status !== 'exited')
    if (busy.length) return `Not finished: ${busy.map((x) => x.name).join(', ')} not merged yet. Wait for their reports first.`
    const v = mission.verifier
    if (v?.status === 'running') return 'The Verifier is still running. Wait for its verdict, then call this again.'
    const r = await this.integrate(mission.id, { detach: true })
    return r.ok || r.pending ? r.message : `Not integrated: ${r.message}${r.files?.length ? ` Conflicting files: ${r.files.join(', ')}.` : ''} Tell the human.`
  }

  /** The human's answer to a pending split. */
  decideSplit(missionId: string, approve: boolean, note: string | null): void {
    const mission = this.missions.get(missionId)
    if (!mission?.split || mission.split.status !== 'pending') return
    mission.split.status = approve ? 'approved' : 'rejected'
    mission.split.note = note?.trim() || null
    if (approve) this.record(mission, 'Approved split', `${mission.split.summary}\n\n${mission.split.workers.map((w) => `- **${w.name}**: ${w.task}`).join('\n')}${mission.split.note ? `\n\nNote: ${mission.split.note}` : ''}`)
    const coord = [...mission.agents.values()].find((x) => x.role === 'coordinator')!
    this.feed(mission, { kind: 'split', from: 'you', to: 'coordinator', text: approve ? `approved${mission.split.note ? `: ${mission.split.note}` : ''}` : `rejected: ${mission.split.note ?? 'no reason given'}`, status: approve ? 'ok' : 'failed' })
    this.deliver(
      coord,
      approve
        ? `[The ORC] The human approved your split.${mission.split.note ? ` Their note: ${mission.split.note}.` : ''} Spawn the workers now with spawn_agent.`
        : `[The ORC] The human rejected your split. Their note: ${mission.split.note ?? '(none)'}. Revise it and call propose_split again.`
    )
  }

  /** Checkpointed mode: the human approved one worker's diff. */
  approveWorker(missionId: string, agentName: string): void {
    const mission = this.missions.get(missionId)
    const a = mission?.agents.get(agentName)
    if (!mission || !a || a.merge !== 'review') return
    this.gitWork = this.gitWork.then(() => this.mergeWorker(mission, a)).catch((err) => this.orcNote(mission, `merge error: ${String(err)}`))
  }

  /** Checkpointed mode: send a worker's diff back with a note instead of merging it. */
  sendBack(missionId: string, agentName: string, note: string): void {
    const mission = this.missions.get(missionId)
    const a = mission?.agents.get(agentName)
    if (!mission || !a || a.merge !== 'review') return
    a.merge = 'committed'
    this.feed(mission, { kind: 'orc', from: 'you', to: a.name, text: `sent back: ${oneLine(note)}` })
    this.deliver(a, `[The ORC] The human reviewed your diff and sent it back: ${note}. Make the changes, then call report_done again.`)
  }

  async workerDiff(missionId: string, agentName: string): Promise<DiffView | null> {
    const mission = this.missions.get(missionId)
    const a = mission?.agents.get(agentName)
    if (!mission || !a?.branch) return null
    // Merge to main deleted the merged workers' branches (unmerged ones are kept).
    if (mission.mergedToMain && a.merge === 'merged' && mission.merged.includes(a.name)) return null
    return this.git.branchDiff(mission.repoPath, mission.baseBranch, a.branch)
  }

  async missionDiff(missionId: string): Promise<DiffView | null> {
    const mission = this.missions.get(missionId)
    // After Merge to main the integration branch is deleted.
    if (!mission || mission.merged.length === 0 || mission.mergedToMain) return null
    return this.git.combinedDiff(mission.repoPath, mission.name, mission.baseBranch)
  }

  /** Runs the space's gate command on the merged result. */
  /** The mission's integration worktree (created from the base branch if nothing merged yet).
   *  Run app runs from here. */
  async ensureIntegration(missionId: string): Promise<string> {
    const mission = this.missions.get(missionId)
    if (!mission) throw new Error('no such mission')
    return this.git.ensureIntegration(mission.repoPath, mission.name, mission.baseBranch)
  }

  async runGate(missionId: string, command: string | null): Promise<void> {
    const mission = this.missions.get(missionId)
    if (!mission || mission.merged.length === 0 || !command) return
    mission.gate = { command, ok: false, exitCode: null, output: 'running…', at: Date.now(), running: true }
    this.emit()
    mission.gate = await this.git.runGate(missionGit.integrationPath(mission.repoPath, mission.name), command)
    this.feed(mission, { kind: 'gate', from: 'orc', to: null, text: `${command}: ${mission.gate.ok ? 'passed' : `failed (exit ${mission.gate.exitCode})`}`, status: mission.gate.ok ? 'ok' : 'failed' })
  }

  /** Verifier runs in progress, by mission: a second request waits for the running one. */
  private verifying = new Map<string, Promise<void>>()

  runVerifier(missionId: string): Promise<void> {
    const running = this.verifying.get(missionId)
    if (running) return running
    const p = this.verifyNow(missionId).finally(() => this.verifying.delete(missionId))
    this.verifying.set(missionId, p)
    return p
  }

  /** The Verifier runs on its own once every team is finished and merged (owner, 2026-11-22):
   *  with No check it is the only automatic review before Merge to main. Once per integration
   *  commit; work merged later makes the report stale and it runs again when that settles. */
  private maybeAutoVerify(mission: Mission): void {
    if (mission.paused || mission.mergedToMain || mission.state !== 'running' || mission.merged.length === 0) return
    if (this.verifying.has(mission.id) || mission.verifier?.integrationCommit === mission.integrationCommit) return
    const workers = [...mission.agents.values()].filter((x) => x.role === 'worker')
    const settled = workers.every((x) => (x.status === 'done' || x.status === 'exited') && (x.merge === 'merged' || x.merge === 'nothing' || (x.status === 'exited' && x.merge === null)))
    if (!settled) return
    this.feed(mission, { kind: 'orc', from: 'orc', to: null, text: 'every team is merged: running the Verifier' })
    void this.runVerifier(mission.id).catch((err) => this.orcNote(mission, `Verifier error: ${String(err)}`))
  }

  private async verifyNow(missionId: string): Promise<void> {
    const mission = this.missions.get(missionId)
    if (!mission || mission.merged.length === 0) return
    const diff = await this.git.combinedDiff(mission.repoPath, mission.name, mission.baseBranch)
    mission.verifier = { status: 'running', report: '', templateHash, promptHash: '', at: Date.now(), integrationCommit: mission.integrationCommit }
    this.emit()
    const r = await this.verify({
      cwd: missionGit.integrationPath(mission.repoPath, mission.name),
      model: mission.models.verifier,
      brief: mission.brief,
      split: mission.split?.status === 'approved' ? mission.split : null,
      reports: [...mission.agents.values()].filter((x) => x.doneSummary).map((x) => ({ worker: x.name, summary: x.doneSummary! })),
      steering: mission.feed.filter((f) => f.kind === 'steer').map((f) => ({ worker: f.to ?? '?', text: f.text })),
      diffStat: diff.files.map((f) => `${f.path} +${f.added} -${f.removed}`).join('\n'),
      patch: diff.patch
    })
    mission.verifier = { status: r.ok ? 'done' : 'failed', report: r.report, templateHash, promptHash: r.promptHash, at: Date.now(), integrationCommit: mission.integrationCommit }
    const verdict = /VERDICT:\s*(\w+)/.exec(r.report)?.[1] ?? (r.ok ? 'done' : 'failed')
    this.record(mission, 'Verifier report', `${r.report}\n\nTemplate sha256 \`${templateHash}\`, prompt sha256 \`${r.promptHash}\`.`)
    this.feed(mission, { kind: 'verifier', from: 'verifier', to: null, text: `verdict: ${verdict}`, status: verdict === 'PASS' ? 'ok' : 'failed' })
    // A queued mission whose Verifier passed goes onto the ORC branch on its own, so the next one
    // builds on it. Work merged meanwhile makes this report stale: the next run integrates that.
    if (mission.queueItemId && (verdict === 'PASS' || verdict === 'CONCERNS') && mission.verifier.integrationCommit === mission.integrationCommit) {
      await this.integrate(mission.id)
    }
  }

  /** How the Verifier runs. Tests swap in a fake. */
  verify = runVerifier

  /** A space's per-role models (index.ts wires this to Spaces). */
  spaceModelsFor: (repo: string) => Partial<RoleModels> = () => ({})

  /** A session's status-line input (Claude Code's JSON) → the line it shows. index.ts wires
   *  this to the plan-usage tracker. */
  statusLine: (status: unknown) => string | null = () => null

  /** Integrates the mission into its repo's ORC branch (the human pressed Integrate, or the
   *  queue's Verifier passed). The mission keeps running; Merge to main later brings it to main. */
  async integrate(missionId: string, opts: { detach?: boolean } = {}): Promise<IntegrateOutcome> {
    const mission = this.missions.get(missionId)
    if (!mission) return { ok: false, message: 'no such mission' }
    if (mission.mergedToMain) return { ok: false, message: 'This mission is already in main.' }
    if (mission.merged.length === 0) return { ok: false, message: 'Nothing is merged into the integration branch yet.' }
    if (this.integrating.has(mission.id)) return { ok: false, message: 'This mission is already being integrated (a merge agent may be resolving a conflict).' }
    this.integrating.add(mission.id)
    this.emit()
    const settle = (r: IntegrateOutcome): IntegrateOutcome => {
      this.integrating.delete(mission.id)
      this.emit()
      return r
    }
    let out: IntegrateOutcome | { wait: Promise<IntegrateOutcome> }
    try {
      out = await this.integrateStep(mission, 0)
    } catch (err) {
      return settle(this.integrateFailed(mission, String((err as Error).message ?? err), []))
    }
    if (!('wait' in out)) return settle(out)
    const pending = out.wait.then(settle)
    if (!opts.detach) return pending
    // The coordinator's call returns at once; the result arrives as a [The ORC] message.
    void pending.then((r) => {
      const coord = [...mission.agents.values()].find((x) => x.role === 'coordinator')
      if (coord) this.deliver(coord, `[The ORC] Integration into ${missionGit.OrcBranch} ${r.ok ? 'finished' : 'failed'}: ${r.message}`)
    })
    return { ok: false, pending: true, message: `Conflicts with work already on ${missionGit.OrcBranch}; a merge agent is resolving them in a throwaway worktree. You will get a message starting with [The ORC] with the result. End your turn; do not call integrate_mission again meanwhile.` }
  }

  /** Mission ids being integrated right now (including while a merge agent resolves). */
  private integrating = new Set<string>()

  private integrateFailed(mission: Mission, message: string, files: string[], feedText?: string): IntegrateOutcome {
    mission.integrateError = { message, files, at: Date.now() }
    this.feed(mission, { kind: 'main', from: 'you', to: null, text: feedText ?? `integrating into ${missionGit.OrcBranch} failed: ${oneLine(message)}`, status: 'failed' })
    return files.length ? { ok: false, message, files } : { ok: false, message }
  }

  /** One attempt to merge into the ORC branch. A conflict starts a merge agent and returns its
   *  pending result; after `tries` races with other integrations it is refused as before. */
  private async integrateStep(mission: Mission, tries: number): Promise<IntegrateOutcome | { wait: Promise<IntegrateOutcome> }> {
    const integrationCommit = mission.integrationCommit
    const r = await this.git.integrateIntoOrc(mission.repoPath, mission.name, mission.mainBranch)
    if (r.kind === 'conflict') {
      const refusal = (files: string[]): IntegrateOutcome =>
        this.integrateFailed(mission, `Conflicts with work already on ${missionGit.OrcBranch} in ${files.join(', ')}. Nothing was integrated.`, files, `integrating into ${missionGit.OrcBranch} refused: conflict in ${files.join(', ')}`)
      if (this.useMergeAgent && mission.state === 'running' && tries < 3) {
        const started = await this.startOrcMerger(mission, r.files, tries)
        if (started) return started
      }
      return refusal(r.files)
    }
    return this.integratedOk(mission, r.kind === 'merged' ? r.commit : null, integrationCommit)
  }

  private integratedOk(mission: Mission, newCommit: string | null, integrationCommit: string | null): IntegrateOutcome {
    const at = Date.now()
    const commit = newCommit ?? (mission.integrated?.commit ?? integrationCommit ?? '')
    // A mission stacked on another one (before the ORC branch existed) brings that one in too.
    for (const m of [mission, ...this.stackChain(mission)]) {
      m.integrated = { commit, at, integrationCommit: m.integrationCommit }
      m.integrateError = null
      if (m !== mission) this.feed(m, { kind: 'main', from: 'you', to: null, text: `integrated into ${missionGit.OrcBranch} with ${mission.name}`, status: 'ok' })
    }
    this.record(mission, `Integrated into ${missionGit.OrcBranch}`, `Commit \`${commit}\`.`)
    this.feed(mission, { kind: 'main', from: 'you', to: null, text: newCommit ? `integrated into ${missionGit.OrcBranch} at ${commit.slice(0, 8)}` : `already on ${missionGit.OrcBranch}`, status: 'ok' })
    return { ok: true, message: newCommit ? `Integrated into ${missionGit.OrcBranch} at ${commit.slice(0, 8)}.` : `Already on ${missionGit.OrcBranch}.` }
  }

  /** Starts a merge agent for a conflict with the ORC branch, in a throwaway merge worktree.
   *  Returns the promise of the final result, or null when it could not start (refuse as before). */
  private async startOrcMerger(mission: Mission, files: string[], tries: number): Promise<{ wait: Promise<IntegrateOutcome> } | null> {
    const key = missionGit.OrcMergeKey
    const orcBranch = missionGit.OrcBranch
    const integration = missionGit.integrationBranch(mission.name)
    let name = slug('merge-orc')
    for (let i = 2; mission.agents.has(name); i++) name = slug(`merge-orc-${i}`)
    const integrationCommit = mission.integrationCommit
    let onDone!: (r: IntegrateOutcome) => void
    const promise = new Promise<IntegrateOutcome>((res) => (onDone = res))
    const st: MergerState = { worker: key, agent: name, files, attempts: 0, queue: [], tries, onDone, integrationCommit }
    if (!this.mergers.has(mission.id)) this.mergers.set(mission.id, new Map())
    this.mergers.get(mission.id)!.set(key, st)
    try {
      const cm = await this.git.startOrcConflictMerge(mission.repoPath, mission.name, mission.mainBranch)
      if (cm.kind !== 'conflict') {
        // Raced: it merged cleanly (or is already there) after all.
        this.dropMerger(mission.id, key)
        if (cm.kind === 'up-to-date') return { wait: Promise.resolve(this.integratedOk(mission, null, integrationCommit)) }
        const done = await this.git.landOrcMerge(mission.repoPath, mission.name, mission.mainBranch, `Integrate ${mission.name} into the ORC branch`)
        if (done.kind === 'merged') return { wait: Promise.resolve(this.integratedOk(mission, done.commit, integrationCommit)) }
        await this.git.discardMerge(mission.repoPath, mission.name, key)
        return null
      }
      st.files = cm.files
      const sessionName = `${mission.name}/${name}`
      const coord = [...mission.agents.values()].find((x) => x.role === 'coordinator')
      const task = `Resolve the merge conflict from integrating ${integration} into ${orcBranch}: ${cm.files.join(', ')}`
      this.launch(mission, {
        name,
        sessionName,
        role: 'worker',
        parent: coord?.name ?? null,
        task,
        cwd: cm.path,
        branch: null,
        systemPrompt: orcMergerPrompt(mission.name, sessionName, coord?.sessionName ?? `${mission.name}/coordinator`, integration, orcBranch, cm.files),
        firstPrompt: task
      })
      mission.agents.get(name)!.mergerFor = key
      this.feed(mission, { kind: 'conflict', from: 'orc', to: name, text: `resolving conflict in ${cm.files.join(', ')} (${integration} into ${orcBranch})` })
      this.emit()
      return { wait: promise }
    } catch (err) {
      this.dropMerger(mission.id, key)
      await this.git.discardMerge(mission.repoPath, mission.name, key).catch(() => {})
      this.orcNote(mission, `could not start a merge agent for ${orcBranch}: ${String((err as Error).message ?? err)}`)
      return null
    }
  }

  /** The ORC-branch merge agent reported done: verify (markers, gate) and land it, or give it
   *  another go, or refuse as before. */
  private async finishOrcMerger(mission: Mission, m: Agent, st: MergerState, summary: string): Promise<void> {
    const key = missionGit.OrcMergeKey
    const orcBranch = missionGit.OrcBranch
    if (/^\s*cannot resolve/i.test(summary)) return this.orcMergerFailed(mission, m, st, `reported it cannot resolve: ${oneLine(summary, 160)}`)
    const retry = (text: string, why: string): boolean => {
      if (++st.attempts < 3) {
        this.deliver(m, text)
        m.status = 'working'
        this.emit()
        return true
      }
      void this.orcMergerFailed(mission, m, st, why)
      return false
    }
    const msg = `Integrate ${mission.name} into the ORC branch\n\nConflict resolved by ${m.name}: ${oneLine(summary, 200)}`
    const c = await this.git.commitOrcMerge(mission.repoPath, mission.name, st.files, msg)
    if (c.kind === 'markers') {
      retry(`[The ORC] Conflict markers are still in ${c.files.join(', ')}. Resolve them, then call report_done again.`, `left conflict markers in ${c.files.join(', ')}`)
      return
    }
    const gate = this.gateCommandFor(mission.repoPath)
    if (gate) {
      this.feed(mission, { kind: 'gate', from: 'orc', to: m.name, text: `${gate} on the merge into ${orcBranch}…` })
      const g = await this.git.runGate(missionGit.mergePath(mission.repoPath, mission.name, key), gate)
      this.feed(mission, { kind: 'gate', from: 'orc', to: null, text: `${gate} (merge into ${orcBranch}): ${g.ok ? 'passed' : `failed (exit ${g.exitCode})`}`, status: g.ok ? 'ok' : 'failed' })
      if (!g.ok) {
        retry(`[The ORC] Your resolution fails the gate \`${gate}\` (exit ${g.exitCode}). Fix it (edit files only, no git), then call report_done again. Output tail:\n${g.output.slice(-1500)}`, `resolution fails the gate: ${oneLine(g.output.slice(-160))}`)
        return
      }
    }
    const done = await this.git.landOrcMerge(mission.repoPath, mission.name, mission.mainBranch, msg)
    if (done.kind === 'moved') {
      // Another integration landed on the same code meanwhile: start over against the new tip.
      this.dropMerger(mission.id, key)
      this.endAgent(mission, m, 'orc', `${orcBranch} moved; redoing the merge`)
      await this.git.discardMerge(mission.repoPath, mission.name, key)
      try {
        const out = await this.integrateStep(mission, st.tries + 1)
        if ('wait' in out) void out.wait.then(st.onDone)
        else st.onDone?.(out)
      } catch (err) {
        st.onDone?.(this.integrateFailed(mission, String((err as Error).message ?? err), []))
      }
      return
    }
    this.dropMerger(mission.id, key)
    this.endAgent(mission, m, 'orc', 'conflict resolved')
    this.feed(mission, { kind: 'conflict', from: m.name, to: null, text: `conflict resolved in ${st.files.join(', ')}`, status: 'ok' })
    st.onDone?.(this.integratedOk(mission, done.commit, st.integrationCommit ?? null))
  }

  /** The merge agent for the ORC branch failed: throw its worktree away and refuse, naming the files. */
  private async orcMergerFailed(mission: Mission, m: Agent, st: MergerState, why: string): Promise<void> {
    this.dropMerger(mission.id, missionGit.OrcMergeKey)
    await this.git.discardMerge(mission.repoPath, mission.name, missionGit.OrcMergeKey).catch(() => {})
    if (!m.shutDown) this.endAgent(mission, m, 'orc', `merge agent failed: ${oneLine(why, 120)}`)
    const files = st.files
    st.onDone?.(this.integrateFailed(mission, `Conflicts with work already on ${missionGit.OrcBranch} in ${files.join(', ')}; the merge agent ${why}. Nothing was integrated.`, files, `integrating into ${missionGit.OrcBranch} refused: merge agent ${oneLine(why, 120)} (conflict in ${files.join(', ')})`))
  }

  /** Legacy stacked missions this one was based on (their work is in its integration branch). */
  private stackChain(mission: Mission): Mission[] {
    const chain: Mission[] = []
    for (let base = mission.baseBranch; ;) {
      const p = [...this.missions.values()].find((x) => x.repoPath === mission.repoPath && !x.mergedToMain && !chain.includes(x) && x !== mission && missionGit.integrationBranch(x.name) === base)
      if (!p) break
      chain.push(p)
      base = p.baseBranch
    }
    return chain
  }

  /** Missions whose latest work is on the repo's ORC branch and not yet in main. */
  private integratedIn(repo: string): Mission[] {
    return [...this.missions.values()].filter((m) => m.repoPath === repo && !m.mergedToMain && !!m.integrated && m.integrated.integrationCommit === m.integrationCommit)
  }

  /** What Merge to main would bring: main...ORC branch. */
  async orcDiff(repo: string): Promise<DiffView | null> {
    const main = this.integratedIn(repo)[0]?.mainBranch ?? (await this.git.currentBranch(repo))
    return this.git.orcDiff(repo, main)
  }

  /** The branch the human merges to, and the remote it would be pushed to (null: no remote). */
  async pushTarget(repo: string): Promise<{ branch: string; remote: string | null; ahead: number | null }> {
    const branch = this.integratedIn(repo)[0]?.mainBranch ?? (await this.git.currentBranch(repo))
    const remote = await missionGit.pushRemote(repo)
    return { branch, remote, ahead: remote ? await missionGit.aheadOfRemote(repo, branch, remote) : null }
  }

  /** The human pressed Push to GitHub: pushes the main branch (never forced). */
  async pushMain(repo: string): Promise<missionGit.PushResult> {
    const { branch } = await this.pushTarget(repo)
    return missionGit.pushBranch(repo, branch)
  }

  /** The human pressed Merge to main: everything on the repo's ORC branch goes into main. Missions
   *  fully on the ORC branch are then ended and cleared out; the rest keep running. */
  async mergeToMain(repo: string): Promise<{ ok: boolean; message: string; cleared?: number; files?: string[] }> {
    const done = this.integratedIn(repo)
    const main = done[0]?.mainBranch ?? (await this.git.currentBranch(repo))
    const r = await this.git.mergeOrcToMain(repo, main)
    if (!r.ok) {
      for (const m of done) this.feed(m, { kind: 'main', from: 'you', to: null, text: `merge to ${main} refused: ${oneLine(r.reason)}`, status: 'failed' })
      return { ok: false, message: r.reason, files: r.files }
    }
    const at = Date.now()
    for (const m of done) {
      m.mergedToMain = { commit: r.commit, at }
      this.record(m, `Merged into ${main}`, `With the ORC branch, commit \`${r.commit}\`.\n\nSessions (reopen with \`claude --resume <id>\`):\n${[...m.agents.values()].map((x) => `- ${x.sessionName}: \`${x.sessionId}\``).join('\n')}`)
      this.feed(m, { kind: 'main', from: 'you', to: null, text: `merged into ${main} at ${r.commit.slice(0, 8)}`, status: 'ok' })
    }
    // Legacy missions stacked on a branch that is about to be deleted: its content is in main now.
    const gone = new Set(done.map((x) => missionGit.integrationBranch(x.name)))
    for (const x of this.missions.values()) if (gone.has(x.baseBranch) && !x.mergedToMain) x.baseBranch = missionGit.OrcBranch
    const kept: string[] = []
    for (const m of done) {
      const k = await this.endMerged(m)
      kept.push(...k.map((x) => `${m.name}/${x.name} on ${x.branch}`))
    }
    // Clear out every mission in this repo whose work is now in main (the record notes were written above).
    let cleared = 0
    for (const x of [...this.missions.values()]) {
      if (x.repoPath === repo && x.mergedToMain && x.state === 'stopped' && this.removeMission(x.id)) cleared++
    }
    const keptNote = kept.length ? ` Kept (not merged): ${kept.join(', ')}.` : ''
    const clearedNote = cleared ? ` Cleared ${cleared} merged mission${cleared === 1 ? '' : 's'}.` : ''
    return { ok: true, cleared, message: `Merged ${missionGit.OrcBranch} into ${main} at ${r.commit.slice(0, 8)}.${keptNote}${clearedNote}` }
  }

  /** The work is in main: end the sessions, then remove merged workers' worktrees and branches
   *  and the integration branch. Returns the workers kept (not merged). */
  private async endMerged(mission: Mission): Promise<Agent[]> {
    this.stopMission(mission.id)
    const workers = [...mission.agents.values()].filter((x) => x.role === 'worker' && x.branch)
    const merged = workers.filter((x) => x.merge === 'merged' && mission.merged.includes(x.name))
    const kept = workers.filter((x) => !merged.includes(x))
    await this.git.cleanupMission(mission.repoPath, mission.name, merged.map((x) => ({ path: x.cwd, branch: x.branch! })))
    if (kept.length) this.orcNote(mission, `not merged, worktrees kept: ${kept.map((x) => x.name).join(', ')}`)
    return kept
  }

  /** A coordinator (or the worker's parent) shuts down a worker whose job is finished. Only
   *  once its work is merged or there was nothing to merge: before that, The ORC may still need
   *  to reach it (a conflict to resolve, a diff sent back). The agent becomes "exited", so a
   *  restart doesn't resume it and nothing is typed into its dead terminal. Worktree and branch
   *  stay (Merge to main cleans them up). */
  stopAgent(callerTerminal: string, rawName: string, reason: string | null): string {
    const caller = this.byTerminal.get(callerTerminal)
    if (!caller) throw new Error('unknown caller')
    const mission = this.missions.get(caller.missionId)!
    const given = rawName.trim()
    const name = given.startsWith(`${mission.name}/`) ? given.slice(mission.name.length + 1) : given
    const a = mission.agents.get(name)
    if (!a || a.role !== 'worker') return `There is no worker named "${name}" in this mission.`
    if (a === caller) return 'You cannot stop yourself. Call report_done when your task is finished.'
    if (caller.role !== 'coordinator' && a.parent !== caller.name) return `Only the coordinator or the agent that started "${name}" can stop it.`
    if (a.status === 'exited') return `"${name}" is already stopped.`
    if (!a.doneSummary) return `"${name}" has not reported done yet. Wait for its report, or message it; only finished workers can be stopped.`
    const live = [...mission.agents.values()].filter((x) => x.parent === a.name && x.status !== 'exited')
    if (live.length) return `"${name}" still has running workers of its own (${live.map((x) => x.name).join(', ')}). Stop those first.`
    if (a.merge !== 'merged' && a.merge !== 'nothing') {
      const why =
        a.merge === 'review' ? 'its diff is waiting for the human\'s review, and they may send it back'
          : a.merge === 'conflict' ? 'its work conflicts with merged work and it is resolving that'
            : 'The ORC is still committing and merging its work'
      return `Not stopped: ${why}. Try again once its work is merged.`
    }
    this.endAgent(mission, a, caller.name, reason?.trim() ? `shut down: ${oneLine(reason)}` : 'shut down: job finished')
    return `Stopped "${a.sessionName}". Its worktree and branch are kept; it can no longer be messaged.`
  }

  /** The human pressed Stop on a worker's card. Unlike stop_agent this works at any point (the
   *  human decides); unfinished changes stay uncommitted in its worktree. Its parent is told so
   *  it stops messaging it. Throws with the reason when refused (the UI shows it). */
  stopWorker(missionId: string, name: string): void {
    const mission = this.missions.get(missionId)
    const a = mission?.agents.get(name)
    if (!mission || !a || a.role !== 'worker') throw new Error(`no worker named "${name}"`)
    if (mission.state !== 'running') throw new Error('this mission is stopped')
    if (a.status === 'exited') return
    const live = [...mission.agents.values()].filter((x) => x.parent === a.name && x.status !== 'exited')
    if (live.length) throw new Error(`${name} still has running workers of its own (${live.map((x) => x.name).join(', ')}). Stop those first.`)
    const finished = !!a.doneSummary && (a.merge === 'merged' || a.merge === 'nothing')
    this.endAgent(mission, a, 'you', finished ? 'shut down: job finished' : 'shut down before its work was merged')
    const parent = a.parent ? mission.agents.get(a.parent) : null
    if (parent && parent.status !== 'exited') {
      // Queued, not typed: it reaches the parent on its next turn or tool call without starting one.
      parent.notes.push(`[The ORC] The human stopped your worker "${a.sessionName}". Its session has ended; do not message it.${finished ? '' : ' Its unfinished work was not merged.'}`)
    }
  }

  /** The X on an exited worker's card: removes it from the cards and tree. Its report, merge
   *  state, worktree and branch are kept. Throws with the reason when refused. */
  dismissAgent(missionId: string, name: string): void {
    const mission = this.missions.get(missionId)
    const a = mission?.agents.get(name)
    if (!mission || !a || a.role !== 'worker') throw new Error(`no worker named "${name}"`)
    if (a.status !== 'exited') throw new Error(`${name} is still running. Stop it first.`)
    if (a.merge === 'review') throw new Error(`${name}'s diff still waits for your review. Approve it first.`)
    if (a.dismissed) return
    a.dismissed = true
    this.emit()
  }

  /** Ends an agent's session for good. Exited before the kill: terminalExited and SessionEnd
   *  leave it alone, restore() doesn't resume it and deliver() types nothing into it. */
  private endAgent(mission: Mission, a: Agent, by: string, text: string): void {
    a.status = 'exited'
    a.shutDown = true
    a.activity = `shut down by ${by}`
    a.inTurn = false
    a.waitingOn = null
    a.question = null
    a.notes = []
    // Its token stops working: no late hook or MCP call (report_done, spawn_agent) acts as it.
    if (a.token) this.byToken.delete(a.token)
    this.terminals.kill(a.terminalId)
    this.feed(mission, { kind: 'stopped', from: by, to: a.name, text })
  }

  askHuman(callerTerminal: string, question: string): void {
    const a = this.byTerminal.get(callerTerminal)
    this.update(callerTerminal, { status: 'needs-you', activity: 'asked you a question', question, waitingOn: 'question', pendingQuestion: question })
    if (a) this.feed(this.missions.get(a.missionId)!, { kind: 'question', from: a.name, to: 'you', text: oneLine(question) })
  }

  /** Applies one hook event. Returns the hook's stdout: JSON carrying queued notes as
   *  additionalContext (PreToolUse and UserPromptSubmit accept it), or null for nothing. */
  hookEvent(callerTerminal: string, e: HookEvent): string | null {
    const agent = this.byTerminal.get(callerTerminal)
    // A hook already in flight when the agent was shut down must not bring its status back.
    if (!agent || agent.shutDown) return null
    // The session's status line (plan usage): returns the text it shows, nothing else changes.
    if (e.hook_event_name === 'OrcStatusLine') return this.statusLine((e as unknown as { status?: unknown }).status)
    const mission = this.missions.get(agent.missionId)!
    agent.lastActivityAt = Date.now()
    if (!agent.tally && typeof e.transcript_path === 'string') agent.tally = new TranscriptTally(e.transcript_path)
    const done = agent.status === 'done'
    const asking = agent.waitingOn === 'question'
    if (e.hook_event_name === 'UserPromptSubmit' || e.hook_event_name === 'PreToolUse') agent.inTurn = true
    if (e.hook_event_name === 'Stop' || e.hook_event_name === 'SessionEnd') agent.inTurn = false
    switch (e.hook_event_name) {
      case 'SessionStart':
        if (agent.status === 'starting') this.update(callerTerminal, { status: 'idle', activity: 'ready' })
        break
      case 'UserPromptSubmit': {
        // A new turn: a cross-session message from another agent, the worker's launch task,
        // or the human typing.
        const cross = parseCrossSession(e.prompt)
        const fromName = cross ? this.agentNameFor(mission, cross.from) : null
        const isLaunch = agent.role === 'worker' && (e.prompt ?? '').trim() === agent.task.trim()
        const fromOrc = (e.prompt ?? '').startsWith('[The ORC]')
        const system = isSystemPrompt(e.prompt)
        const human = !cross && !isLaunch && !fromOrc && !system
        if (human && agent.role === 'coordinator' && !mission.brief) mission.brief = e.prompt ?? null
        if (human) agent.lastHumanAt = Date.now()
        if (human && agent.pendingQuestion) {
          this.record(mission, `Question from ${agent.name}`, `Q: ${agent.pendingQuestion}\n\nA: ${(e.prompt ?? '').trim()}`)
          agent.pendingQuestion = null
        }
        const taskDone = (e.prompt ?? '').trim().startsWith('<task-notification')
        this.update(callerTerminal, {
          status: 'working',
          activity: cross ? `message from ${fromName}` : taskDone ? 'subagent finished' : 'thinking',
          question: null,
          waitingOn: null,
          ...(cross && agent.role === 'worker' ? { lastInstructionBy: 'coordinator' as const, lastInstructionAt: Date.now() } : {}),
          ...(human ? { lastInstructionBy: 'you' as const, lastInstructionAt: Date.now() } : {})
        })
        if (cross) this.feed(mission, { kind: 'delivered', from: fromName!, to: agent.name, text: oneLine(cross.body) })
        // Paused: a turn the human didn't start (an agent's message) is interrupted at once.
        if (mission.paused && (cross || fromOrc)) this.terminals.write(callerTerminal, '\x1b')
        if (human && agent.role === 'worker') this.humanSteered(mission, agent, e.prompt ?? '')
        break
      }
      case 'PreToolUse':
      case 'PostToolUse':
        // A tool running means any permission prompt was answered yes.
        this.update(callerTerminal, {
          ...(done || asking ? {} : { status: 'working' as const, waitingOn: null }),
          activity: describeTool(e.tool_name, e.tool_input)
        })
        if (e.hook_event_name === 'PostToolUse' && e.tool_name === 'SendMessage') this.messageSent(mission, agent, e)
        break
      case 'Notification':
        // Claude Code also notifies when a session has merely sat idle waiting for input
        // (notification_type "idle_prompt"); that is not "needs you". Permission prompts are
        // notification_type "permission_prompt", sent ~6 s after the prompt appears.
        if (e.notification_type === 'idle_prompt' || /waiting for your input/i.test(e.message ?? '')) break
        // Even a "done" agent can be at a permission prompt (it kept working after reporting).
        if (!asking && (!done || e.notification_type === 'permission_prompt')) {
          this.update(callerTerminal, { status: 'needs-you', activity: e.message ?? 'needs you', waitingOn: 'permission' })
        }
        break
      case 'Stop':
        // A worker that has reported (and isn't in conflict) goes back to done, not idle.
        if (!done && !asking) {
          const back = agent.doneSummary && agent.merge !== 'conflict' ? 'done' : 'idle'
          this.update(callerTerminal, { status: back, activity: back === 'done' ? 'reported done' : 'turn finished', waitingOn: null })
        }
        // Notes queued while it was busy would otherwise wait for a hook that never comes.
        if (agent.notes.length) setTimeout(() => this.flushNotes(agent), 800)
        break
      case 'SessionEnd':
        // A finished worker stays "done" when its session ends (e.g. after Merge to main).
        if (!done) this.update(callerTerminal, { status: 'exited', waitingOn: null })
        break
    }
    // A lead's subagents fire its hooks too (with agent_id set). Notes are for the lead itself, so
    // they wait for one of its own tool calls rather than landing in a subagent's context.
    const fromSubagent = typeof e.agent_id === 'string' && e.agent_id !== ''
    if ((e.hook_event_name === 'PreToolUse' || e.hook_event_name === 'UserPromptSubmit') && agent.notes.length && !fromSubagent) {
      const additionalContext = agent.notes.splice(0).join('\n')
      return JSON.stringify({ hookSpecificOutput: { hookEventName: e.hook_event_name, additionalContext } })
    }
    return null
  }

  /** Backup status from `claude agents --json` (interactive sessions: busy | idle | waiting).
   *  Hooks miss some transitions: pressing Esc on a permission prompt interrupts the turn and
   *  fires no hook at all. A session reported idle on two polls in a row while we think it is
   *  working or at a permission prompt is idle. */
  reconcile(states: Map<string, string>): void {
    for (const agent of this.byTerminal.values()) {
      // An interrupted turn fires no Stop: whatever the status, idle twice means the turn is over.
      if (agent.inTurn && states.get(agent.sessionId) === 'idle') {
        agent.turnIdlePolls = (agent.turnIdlePolls ?? 0) + 1
        if (agent.turnIdlePolls >= 2) {
          agent.inTurn = false
          agent.turnIdlePolls = 0
          if (agent.notes.length) setTimeout(() => this.flushNotes(agent), 800)
        }
      } else agent.turnIdlePolls = 0
      // "waiting" = at a permission prompt; it shows up here before the Notification hook does.
      if (states.get(agent.sessionId) === 'waiting' && (agent.status === 'working' || agent.status === 'done')) {
        this.update(agent.terminalId, { status: 'needs-you', activity: 'needs your permission', waitingOn: 'permission' })
        continue
      }
      const live = agent.status === 'working' || agent.waitingOn === 'permission'
      if (!live || states.get(agent.sessionId) !== 'idle') {
        agent.idlePolls = 0
        continue
      }
      if (++agent.idlePolls >= 2) {
        agent.idlePolls = 0
        // Esc fires no Stop: the turn is over, so queued notes can go now.
        agent.inTurn = false
        if (agent.notes.length) setTimeout(() => this.flushNotes(agent), 800)
        this.update(agent.terminalId, {
          status: 'idle',
          activity: agent.waitingOn === 'permission' ? 'permission prompt dismissed' : 'interrupted',
          waitingOn: null
        })
      }
    }
  }

  /** Session ids worth polling for (live and not finished). */
  liveSessionIds(): string[] {
    return [...this.byTerminal.values()]
      .filter((a) => a.status === 'working' || a.status === 'needs-you')
      .map((a) => a.sessionId)
  }

  /** Re-reads every live session's transcript and updates token counts. */
  async refreshTokens(): Promise<void> {
    let changed = false
    for (const a of this.byTerminal.values()) {
      if (!a.tally || a.status === 'exited') continue
      const c = await a.tally.update()
      if (c.tokens !== a.tokens || c.contextTokens !== a.contextTokens) {
        a.tokens = c.tokens
        a.contextTokens = c.contextTokens
        changed = true
      }
    }
    if (changed) this.emit()
  }

  // Terminal side -----------------------------------------------------------

  /** Enter typed in a terminal: the human gave an instruction. (The steering note to the
   *  coordinator waits for the worker's UserPromptSubmit, which carries the text.) */
  noteHumanInput(terminalId: string, data: string): void {
    if (data.includes('\r')) {
      const a = this.byTerminal.get(terminalId)
      if (a) a.lastActivityAt = a.lastHumanAt = Date.now()
      this.update(terminalId, { lastInstructionBy: 'you', lastInstructionAt: Date.now() })
    }
  }

  terminalExited(terminalId: string, exitCode = 0): void {
    const a = this.byTerminal.get(terminalId)
    if (!a || a.status === 'done') return
    // Exiting before Claude Code ever said hello: it failed to start (not on PATH, bad flag,
    // untrusted folder, …). Its terminal shows why; say so on the card.
    const failedToStart = a.status === 'starting'
    const mission0 = this.missions.get(a.missionId)
    // A crash = a non-zero exit nobody asked for: not already ended (Stop, stop_agent, mission stop)
    // and not after report_done (returned above).
    const crashed = exitCode !== 0 && a.status !== 'exited' && !a.shutDown && mission0?.state === 'running'
    this.update(terminalId, {
      exitKind: crashed ? 'crashed' : 'clean',
      exitCode: crashed ? exitCode : null,
      status: 'exited',
      activity: failedToStart ? `claude exited before starting (code ${exitCode}): see its terminal` : a.activity,
      inTurn: false
    })
    if (a.mergerFor && !a.shutDown) {
      const mission = this.missions.get(a.missionId)!
      this.gitWork = this.gitWork.then(() => this.mergerFailed(mission, a, 'exited before finishing')).catch((err) => this.orcNote(mission, `merge error: ${String(err)}`))
    }
    if (failedToStart) this.orcNote(this.missions.get(a.missionId)!, `${a.name}: claude exited before starting (code ${exitCode}). Its terminal shows the reason.`)
  }

  shutdown(): void {
    this.terminals.killAll()
  }

  // Internals ---------------------------------------------------------------

  private async afterDone(mission: Mission, a: Agent, summary: string): Promise<void> {
    if (!a.branch || mission.mergedToMain) return
    // A conflict hand-back is only finished when the markers are gone.
    if (a.merge === 'conflict') {
      const left = a.conflictFiles.filter((f) => {
        try {
          return /^<{7}( |$)/m.test(readFileSync(join(a.cwd, f), 'utf8'))
        } catch {
          return false
        }
      })
      if (left.length) {
        this.deliver(a, `[The ORC] Conflict markers are still in ${left.join(', ')}. Resolve them, then call report_done again.`)
        return
      }
    }
    const title = oneLine(summary.split('\n')[0], 72)
    const sha = await this.git.commitAll(mission.repoPath, a.cwd, `${a.name}: ${title}\n\n${summary}\n\nMission: ${mission.name}\nORC-Agent: ${a.sessionName}`)
    if (sha) this.feed(mission, { kind: 'commit', from: 'orc', to: a.name, text: `committed ${sha.slice(0, 8)} on ${a.branch}` })
    if (!sha && a.merge !== 'conflict' && !(await this.hasUnmergedCommits(mission, a))) {
      a.merge = mission.merged.includes(a.name) ? 'merged' : 'nothing'
      this.emit()
      this.maybeAutoVerify(mission)
      return
    }
    a.merge = 'committed'
    await this.routeCommitted(mission, a)
  }

  /** What happens to committed work: held while paused, reviewed when checkpointed, else merged. */
  private async routeCommitted(mission: Mission, a: Agent): Promise<void> {
    if (mission.paused) {
      if (!mission.held.includes(a.name)) mission.held.push(a.name)
      this.feed(mission, { kind: 'orc', from: 'orc', to: a.name, text: 'merge held: mission paused' })
      return
    }
    if (mission.gating === 'checkpointed') {
      a.merge = 'review'
      this.feed(mission, { kind: 'orc', from: a.name, to: 'you', text: 'diff waiting for your review before it merges' })
      this.emit()
      return
    }
    await this.mergeWorker(mission, a)
  }

  private async hasUnmergedCommits(mission: Mission, a: Agent): Promise<boolean> {
    const r = await missionGit.git(mission.repoPath, ['rev-list', '--count', `${missionGit.integrationBranch(mission.name)}..${a.branch}`], { allowFail: true })
    if (r.code !== 0) return (await missionGit.git(mission.repoPath, ['rev-list', '--count', `${mission.baseBranch}..${a.branch}`], { allowFail: true })).stdout !== '0'
    return r.stdout !== '0'
  }

  /** Conflicted merges per mission (by worker) that a merge agent is resolving, each in its own
   *  merge worktree, so several run in parallel and none holds the integration worktree. A merge
   *  whose conflicting files overlap an active one waits in that one's `queue` and is retried
   *  once it lands. Not persisted: a restart leaves stale merge worktrees, replaced the next
   *  time that worker conflicts. */
  private mergers = new Map<string, Map<string, MergerState>>()
  /** Off: a conflict goes straight back to the worker (unit tests of that path). */
  useMergeAgent = true

  private mergerFor(missionId: string, agentName: string): MergerState | undefined {
    for (const st of this.mergers.get(missionId)?.values() ?? []) if (st.agent === agentName) return st
    return undefined
  }

  private dropMerger(missionId: string, worker: string): void {
    const m = this.mergers.get(missionId)
    m?.delete(worker)
    if (m?.size === 0) this.mergers.delete(missionId)
  }

  private async mergeWorker(mission: Mission, a: Agent, tries = 0): Promise<void> {
    const active = this.mergers.get(mission.id)
    if (active?.has(a.name)) return
    for (const st of active?.values() ?? []) if (st.queue.includes(a.name)) return
    await this.git.ensureIntegration(mission.repoPath, mission.name, mission.baseBranch)
    const integration = missionGit.integrationBranch(mission.name)
    // After repeated races with other landing merges, stop retrying and hand it back.
    const keep = this.useMergeAgent && !a.shutDown && mission.state === 'running' && tries < 3
    const r = await this.git.mergeIntoIntegration(mission.repoPath, mission.name, a.branch!, `Merge ${a.name} into ${integration}`)
    if (r.kind === 'conflict') {
      if (keep) {
        const blocker = [...(this.mergers.get(mission.id)?.values() ?? [])].find((st) => st.files.some((f) => r.files.includes(f)))
        if (blocker) {
          blocker.queue.push(a.name)
          this.feed(mission, { kind: 'orc', from: 'orc', to: a.name, text: `merge waits: a conflict in ${blocker.files.join(', ')} is being resolved first` })
          return
        }
        if (await this.startMerger(mission, a, r.files, tries)) return
      }
      await this.conflictFallback(mission, a, r.files)
      return
    }
    await this.mergedInto(mission, a, r.kind === 'merged' ? r.commit : null)
  }

  /** The old behavior: the worker resolves it in its own worktree, or the human is told. */
  private async conflictFallback(mission: Mission, a: Agent, files: string[]): Promise<void> {
    const integration = missionGit.integrationBranch(mission.name)
    const coord = [...mission.agents.values()].find((x) => x.role === 'coordinator')
    a.merge = 'conflict'
    a.conflictFiles = files
    if (a.shutDown) {
      // Its session is gone, so nobody can resolve it in its worktree: leave the worktree alone
      // (the merge was aborted) and hand the conflict to the coordinator and the human.
      this.feed(mission, { kind: 'conflict', from: a.name, to: 'you', text: `conflicts with ${integration} in ${files.join(', ')}; ${a.name} is stopped, so it was not merged`, status: 'failed' })
      if (coord) this.deliver(coord, `[The ORC] ${a.name}'s work conflicts with already-merged work in ${files.join(', ')}, and ${a.name} was stopped, so it was not merged. Tell the human; a new worker can redo that part.`)
      this.emit()
      return
    }
    this.feed(mission, { kind: 'conflict', from: a.name, to: 'coordinator', text: `conflicts with ${integration} in ${files.join(', ')}`, status: 'failed' })
    // Leave the conflict in the worker's own worktree for it to resolve; its next
    // report_done commits the resolution and the merge is retried.
    await this.git.prepareConflict(mission.repoPath, a.cwd, integration)
    this.deliver(a, `[The ORC] Your branch conflicts with work already merged (${files.join(', ')}). The conflict markers are now in your worktree. Edit the files to resolve them so both changes survive. Run no git commands (The ORC stages and commits), then call report_done again.`)
    if (coord) this.deliver(coord, `[The ORC] ${a.name}'s work conflicts with already-merged work in ${files.join(', ')}. ${a.name} has been asked to resolve it; step in if it needs direction.`)
    // Its work is not done any more: it has a conflict to resolve. Without this, "done" is
    // sticky and a permission prompt during the resolution never shows as needs-you.
    a.status = 'working'
    a.activity = 'resolving a conflict'
    this.emit()
  }

  /** Starts a merge agent in the worker's own merge worktree, which holds the conflicted merge.
   *  Returns true when the merge is handled (agent started, or it merged cleanly after all);
   *  false when it could not start (the caller falls back). */
  private async startMerger(mission: Mission, a: Agent, files: string[], tries: number): Promise<boolean> {
    let name = slug(`merge-${a.name}`)
    for (let i = 2; mission.agents.has(name); i++) name = slug(`merge-${a.name}-${i}`)
    const st: MergerState = { worker: a.name, agent: name, files, attempts: 0, queue: [], tries }
    if (!this.mergers.has(mission.id)) this.mergers.set(mission.id, new Map())
    this.mergers.get(mission.id)!.set(a.name, st)
    const integration = missionGit.integrationBranch(mission.name)
    try {
      const cm = await this.git.startConflictMerge(mission.repoPath, mission.name, a.name, a.branch!, `Merge ${a.name} into ${integration}`)
      if (cm.kind === 'clean') {
        // Another merge landed in between and the conflict is gone: just land it.
        this.dropMerger(mission.id, a.name)
        const done = await this.git.landMerge(mission.repoPath, mission.name, a.name, `Merge ${a.name} into ${integration}`)
        if (done.kind === 'merged') await this.mergedInto(mission, a, done.commit)
        else {
          await this.git.discardMerge(mission.repoPath, mission.name, a.name)
          await this.mergeWorker(mission, a, tries + 1)
        }
        await this.drainMerges(mission, st.queue)
        return true
      }
      st.files = cm.files
      const sessionName = `${mission.name}/${name}`
      const coord = [...mission.agents.values()].find((x) => x.role === 'coordinator')
      const task = `Resolve the merge conflict from merging ${a.name} into ${integration}: ${cm.files.join(', ')}`
      this.launch(mission, {
        name,
        sessionName,
        role: 'worker',
        parent: coord?.name ?? null,
        task,
        cwd: cm.path,
        branch: null,
        systemPrompt: mergerPrompt(mission.name, sessionName, coord?.sessionName ?? `${mission.name}/coordinator`, a.name, cm.files),
        firstPrompt: task
      })
      mission.agents.get(name)!.mergerFor = a.name
      a.merge = 'conflict'
      a.conflictFiles = cm.files
      this.feed(mission, { kind: 'conflict', from: 'orc', to: name, text: `resolving conflict in ${cm.files.join(', ')} (${a.name} into ${integration})` })
      this.emit()
      return true
    } catch (err) {
      this.dropMerger(mission.id, a.name)
      await this.git.discardMerge(mission.repoPath, mission.name, a.name).catch(() => {})
      this.orcNote(mission, `could not start a merge agent: ${String((err as Error).message ?? err)}`)
      return false
    }
  }

  /** A merge agent reported done (or `cannot resolve`): conclude the merge or fall back. */
  private async finishMerger(mission: Mission, m: Agent, summary: string): Promise<void> {
    const st = this.mergerFor(mission.id, m.name)
    if (!st) return
    if (st.worker === missionGit.OrcMergeKey) return this.finishOrcMerger(mission, m, st, summary)
    const w = mission.agents.get(st.worker)!
    if (/^\s*cannot resolve/i.test(summary)) return this.mergerFailed(mission, m, `reported it cannot resolve: ${oneLine(summary, 160)}`)
    const integration = missionGit.integrationBranch(mission.name)
    const r = await this.git.concludeMerge(mission.repoPath, mission.name, w.name, st.files, `Merge ${w.name} into ${integration}\n\nConflict resolved by ${m.name}: ${oneLine(summary, 200)}`)
    if (r.kind === 'markers') {
      if (++st.attempts < 3) {
        this.deliver(m, `[The ORC] Conflict markers are still in ${r.files.join(', ')}. Resolve them, then call report_done again.`)
        m.status = 'working'
        this.emit()
        return
      }
      return this.mergerFailed(mission, m, `left conflict markers in ${r.files.join(', ')}`)
    }
    this.dropMerger(mission.id, st.worker)
    this.endAgent(mission, m, 'orc', r.kind === 'moved' ? 'integration moved; redoing the merge' : 'conflict resolved')
    if (r.kind === 'moved') {
      // Another merge landed on the same code meanwhile: start over against the new tip.
      await this.git.discardMerge(mission.repoPath, mission.name, w.name)
      await this.mergeWorker(mission, w, st.tries + 1)
    } else {
      this.feed(mission, { kind: 'conflict', from: m.name, to: w.name, text: `conflict resolved in ${st.files.join(', ')}`, status: 'ok' })
      await this.mergedInto(mission, w, r.commit)
    }
    await this.drainMerges(mission, st.queue)
  }

  /** The merge agent failed: drop its merge worktree and use the old hand-back. */
  private async mergerFailed(mission: Mission, m: Agent, why: string): Promise<void> {
    const st = this.mergerFor(mission.id, m.name)
    if (!st) return
    if (st.worker === missionGit.OrcMergeKey) return this.orcMergerFailed(mission, m, st, why)
    this.dropMerger(mission.id, st.worker)
    await this.git.discardMerge(mission.repoPath, mission.name, st.worker)
    if (mission.state === 'stopped') return
    if (!m.shutDown) this.endAgent(mission, m, 'orc', `merge agent failed: ${oneLine(why, 120)}`)
    this.feed(mission, { kind: 'conflict', from: m.name, to: 'you', text: `merge agent ${why}; falling back to ${st.worker}`, status: 'failed' })
    await this.conflictFallback(mission, mission.agents.get(st.worker)!, st.files)
    await this.drainMerges(mission, st.queue)
  }

  private async drainMerges(mission: Mission, queue: string[]): Promise<void> {
    for (const n of queue) {
      const w = mission.agents.get(n)
      if (w?.branch && w.merge !== 'merged') await this.mergeWorker(mission, w)
    }
  }

  private async mergedInto(mission: Mission, a: Agent, commit: string | null): Promise<void> {
    a.merge = 'merged'
    a.conflictFiles = []
    if (!mission.merged.includes(a.name)) mission.merged.push(a.name)
    if (commit) {
      mission.integrationCommit = commit
      this.feed(mission, { kind: 'merge', from: a.name, to: null, text: `merged into ${missionGit.integrationBranch(mission.name)}`, status: 'ok' })
      const gate = this.gateCommandFor(mission.repoPath)
      if (gate) await this.runGate(mission.id, gate)
    }
    this.emit()
    this.maybeAutoVerify(mission)
  }

  /** A space's mission-records folder, or null (off: unit tests). index.ts wires this to Spaces. */
  recordsDirFor: (repo: string) => string | null = () => null

  /** Earlier missions' record notes in this space, for the coordinator to read. */
  private pastRecordsFor(m: Mission): string[] {
    const dir = this.recordsDirFor(m.repoPath)
    return dir ? pastRecords(dir, recordPath(dir, m.name, m.createdAt)) : []
  }

  /** Appends to the mission's record note when the space has a records folder. Never throws. */
  private record(m: Mission, heading: string, body: string): void {
    const dir = this.recordsDirFor(m.repoPath)
    if (!dir) return
    try {
      if (!m.recorded) {
        m.recorded = true
        appendRecord(dir, m, 'Brief', m.brief ?? '(not recorded)')
      }
      appendRecord(dir, m, heading, body)
    } catch (err) {
      this.orcNote(m, `could not write the mission record: ${String(err)}`)
    }
  }

  /** Most live agents per space. index.ts wires this to Spaces. */
  liveLimitFor: (repo: string) => number = () => 6

  /** Live = its process is running and it isn't done or exited (done agents sit idle and
   *  cost nothing; working, idle, starting and needs-you agents count). */
  liveIn(repo: string): number {
    let n = 0
    for (const m of this.missions.values()) {
      if (m.repoPath !== repo || m.state !== 'running') continue
      for (const a of m.agents.values()) if (a.status !== 'done' && a.status !== 'exited' && this.terminals.isRunning(a.terminalId)) n++
    }
    return n
  }

  /** Pause: every agent mid-turn gets Esc; spawns, merges and deliveries are held. The human
   *  can still type to any agent. */
  pauseMission(id: string): void {
    const m = this.missions.get(id)
    if (!m || m.paused || m.state !== 'running') return
    m.paused = true
    for (const a of m.agents.values()) if (a.inTurn) this.terminals.write(a.terminalId, '\x1b')
    this.feed(m, { kind: 'orc', from: 'you', to: null, text: 'mission paused: agents interrupted; spawns, merges and messages from The ORC are held' })
  }

  resumeMission(id: string): void {
    const m = this.missions.get(id)
    if (!m || !m.paused) return
    m.paused = false
    this.feed(m, { kind: 'orc', from: 'you', to: null, text: `mission resumed${m.held.length ? `; merging held work: ${m.held.join(', ')}` : ''}`, status: 'ok' })
    for (const name of m.held.splice(0)) {
      const a = m.agents.get(name)
      if (a) this.gitWork = this.gitWork.then(() => this.routeCommitted(m, a)).catch((err) => this.orcNote(m, `merge error: ${String(err)}`))
    }
    for (const a of m.agents.values()) this.flushNotes(a)
  }

  /** Where a space's gate command comes from. index.ts wires this to Spaces. */
  gateCommandFor: (repo: string) => string | null = () => null

  /** Gets text to an agent: typed into its terminal when it is idle (Claude Code has no way to
   *  message a session from outside), otherwise attached to its next hook. */
  deliver(a: Agent, text: string): void {
    const line = text.replace(/\s+/g, ' ')
    if (a.status === 'exited') return
    a.lastActivityAt = Date.now()
    if (!a.inTurn && !this.missions.get(a.missionId)?.paused && (a.status === 'idle' || a.status === 'done')) {
      this.terminals.write(a.terminalId, line)
      setTimeout(() => this.terminals.write(a.terminalId, '\r'), 500)
    } else {
      a.notes.push(line)
    }
  }

  /** Types queued notes into an agent that has gone idle. */
  private flushNotes(a: Agent): void {
    if (!a.notes.length || a.inTurn || this.missions.get(a.missionId)?.paused || (a.status !== 'idle' && a.status !== 'done')) return
    const text = a.notes.splice(0).join(' ')
    this.terminals.write(a.terminalId, text)
    setTimeout(() => this.terminals.write(a.terminalId, '\r'), 500)
  }

  private orcNote(mission: Mission, text: string, status: 'ok' | 'failed' = 'failed'): void {
    this.feed(mission, { kind: 'orc', from: 'orc', to: null, text: oneLine(text), status })
  }

  private humanSteered(mission: Mission, worker: Agent, prompt: string): void {
    this.feed(mission, { kind: 'steer', from: 'you', to: worker.name, text: oneLine(prompt) })
    const parent = worker.parent ? mission.agents.get(worker.parent) : null
    if (parent && parent.status !== 'exited') {
      parent.notes.push(
        `[The ORC] The human typed directly to your worker "${worker.sessionName}": "${oneLine(prompt, 400)}". ` +
          'They are steering that worker themselves. Do not override or repeat their instructions to it.'
      )
    }
  }

  private messageSent(mission: Mission, sender: Agent, e: HookEvent): void {
    const input = e.tool_input ?? {}
    const res = (e.tool_response ?? {}) as { success?: boolean; message?: string; display?: string }
    const to = typeof input.to === 'string' ? this.agentNameFor(mission, input.to) : null
    const failed = res.success === false || /^not sent/i.test(res.message ?? '') || /^not sent/i.test(res.display ?? '')
    const text = typeof input.summary === 'string' ? input.summary : typeof input.message === 'string' ? input.message : ''
    this.feed(mission, {
      kind: 'message',
      from: sender.name,
      to,
      text: oneLine(failed ? `${text} — ${res.message ?? res.display ?? 'not sent'}` : text),
      status: failed ? 'failed' : 'sent'
    })
  }

  /** "mission/agent" → "agent" when it belongs to this mission; otherwise the name as given. */
  private agentNameFor(mission: Mission, sessionName: string): string {
    for (const a of mission.agents.values()) if (a.sessionName === sessionName) return a.name
    // Claude Code shows "@mission-agent" style handles too.
    for (const a of mission.agents.values()) if (sessionName === a.sessionName.replace('/', '-')) return a.name
    return sessionName
  }

  private feed(mission: Mission, entry: Omit<FeedEntry, 'id' | 'at'>): void {
    mission.feed.push({ id: ++this.feedSeq, at: Date.now(), ...entry })
    if (mission.feed.length > MaxFeed) mission.feed.splice(0, mission.feed.length - MaxFeed)
    this.emit()
  }

  private launch(
    mission: Mission,
    a: Pick<AgentView, 'name' | 'sessionName' | 'role' | 'parent' | 'task' | 'cwd' | 'branch'> & {
      systemPrompt: string
      firstPrompt?: string
    }
  ): void {
    const token = randomBytes(24).toString('hex')
    const terminalId = `${mission.id}:${a.name}`
    const agent: Agent = {
      ...a,
      status: 'starting',
      activity: 'starting',
      lastInstructionBy: a.role === 'worker' ? 'coordinator' : null,
      lastInstructionAt: a.role === 'worker' ? Date.now() : null,
      sessionId: randomUUID(),
      terminalId,
      question: null,
      doneSummary: null,
      tokens: 0,
      contextTokens: 0,
      startedAt: Date.now(),
      merge: null,
      conflictFiles: [],
      waitingOn: null,
      idlePolls: 0,
      tally: null,
      notes: [],
      inTurn: false,
      pid: null,
      token,
      missionId: mission.id,
      lastActivityAt: Date.now(),
      lastHumanAt: null,
      pendingQuestion: null
    }
    delete (agent as Partial<typeof a>).systemPrompt
    delete (agent as Partial<typeof a>).firstPrompt
    mission.agents.set(a.name, agent)
    this.byTerminal.set(terminalId, agent)
    this.startSession(mission, agent, { systemPrompt: a.systemPrompt, firstPrompt: a.firstPrompt })
  }

  /** Starts (or, with `resume`, reattaches) an agent's claude in a terminal, with a fresh
   *  bearer token. Tokens are never saved: every launch gets new ones. */
  private startSession(mission: Mission, agent: Agent, o: { systemPrompt: string; firstPrompt?: string; resume?: boolean }): void {
    if (agent.token) this.byToken.delete(agent.token)
    agent.token = randomBytes(24).toString('hex')
    this.byToken.set(agent.token, agent)
    const { command, args } = this.launcher(
      claudeArgs({
        sessionName: agent.sessionName,
        sessionId: agent.sessionId,
        resume: o.resume,
        token: agent.token,
        controlPort: this.controlPort,
        permissionMode: mission.permissionMode,
        model: agent.role === 'coordinator' ? mission.models.coordinator : mission.models.lead,
        subagentModel: mission.models.subagent,
        advisorModel: mission.models.advisor,
        ownStatusLine: ownerStatusLine(agent.cwd),
        systemPrompt: o.systemPrompt,
        firstPrompt: o.firstPrompt,
        // The coordinator reads earlier missions' records, which live outside the repo.
        readDirs: agent.role === 'coordinator' ? [this.recordsDirFor(mission.repoPath)].filter((d): d is string => !!d) : []
      })
    )
    this.terminals.start({ id: agent.terminalId, command, args, cwd: agent.cwd, env: sessionEnv(process.env, claudeAccounts.configDirForMission(mission.id)) })
    agent.pid = this.terminals.pid(agent.terminalId)
    this.emit()
  }

  private systemPromptFor(mission: Mission, a: Agent): string {
    if (a.role === 'coordinator') return coordinatorPrompt(mission.name, a.sessionName, mission.repoPath, mission.gating, this.pastRecordsFor(mission))
    const parent = a.parent ? mission.agents.get(a.parent) : null
    return workerPrompt(mission.name, a.sessionName, parent?.sessionName ?? `${mission.name}/coordinator`)
  }

  // Persistence and recovery (M4) --------------------------------------------

  /** Everything needed to bring missions back after a restart. No tokens, no live state. */
  snapshot(): SavedState {
    return {
      version: 1,
      savedAt: Date.now(),
      missions: [...this.missions.values()].map((m) => ({
        id: m.id, name: m.name, repoPath: m.repoPath, baseBranch: m.baseBranch, permissionMode: m.permissionMode,
        models: m.models, mainBranch: m.mainBranch, queueItemId: m.queueItemId, state: m.state, createdAt: m.createdAt, feed: m.feed.slice(-MaxFeed), gating: m.gating,
        split: m.split, merged: m.merged, integrationCommit: m.integrationCommit, gate: m.gate,
        verifier: m.verifier?.status === 'running' ? null : m.verifier, mergedToMain: m.mergedToMain, integrated: m.integrated, integrateError: m.integrateError, brief: m.brief, paused: m.paused, recorded: m.recorded,
        agents: [...m.agents.values()].map((a) => ({
          ...agentView(a),
          transcriptPath: a.tally?.path ?? null,
          pid: a.pid ?? null,
          notes: a.notes,
          ...(a.pendingQuestion ? { pendingQuestion: a.pendingQuestion } : {})
        }))
      }))
    }
  }

  /** Brings saved missions back. Running missions' live agents are reattached with
   *  `claude --resume` (or started fresh if they never had a turn). Returns what it did. */
  async restore(saved: SavedState, opts: { isOrphan: (pid: number, sessionId: string) => boolean; kill: (pid: number) => void }): Promise<string[]> {
    const log: string[] = []
    if (saved?.version !== 1) return log
    // A repo folder moved or renamed while the app was closed leaves every worktree's git links stale.
    for (const repo of new Set(saved.missions.map((m) => m.repoPath))) {
      await missionGit.repairWorktreesSerialized(repo).catch(() => {})
    }
    for (const sm of saved.missions) {
      if (this.missions.has(sm.id)) continue
      const { agents: savedAgents, model: legacyModel, models, mainBranch, queueItemId, integrated, integrateError, ...rest } = sm
      // Saved before per-role models: keep what it ran with (one model, or Claude Code's defaults).
      const legacy = legacyModel?.trim() || null
      const mission: Mission = {
        ...rest,
        models: models ?? { ...Object.fromEntries(ModelRoles.map((r) => [r, legacy])), advisor: null } as RoleModels,
        mainBranch: mainBranch ?? rest.baseBranch,
        queueItemId: queueItemId ?? null,
        integrated: integrated ?? null,
        integrateError: integrateError ?? null,
        agents: new Map(),
        held: []
      }
      this.missions.set(mission.id, mission)
      this.feedSeq = Math.max(this.feedSeq, ...mission.feed.map((f) => f.id))
      for (const sa of savedAgents) {
        const { transcriptPath, pid, notes, pendingQuestion, ...view } = sa
        const agent: Agent = {
          ...view,
          waitingOn: view.question ? 'question' : null,
          idlePolls: 0,
          tally: transcriptPath ? new TranscriptTally(transcriptPath) : null,
          notes: notes ?? [],
          inTurn: false,
          token: '',
          missionId: mission.id,
          pid: null,
          lastActivityAt: Date.now(),
          lastHumanAt: null,
          pendingQuestion: pendingQuestion ?? null
        }
        mission.agents.set(agent.name, agent)
        this.byTerminal.set(agent.terminalId, agent)
        // A process that outlived the app and is still this agent's session: end it first.
        if (pid && opts.isOrphan(pid, agent.sessionId)) {
          opts.kill(pid)
          log.push(`${mission.name}/${agent.name}: ended orphaned process ${pid}`)
        }
      }
      if (mission.state !== 'running' || mission.mergedToMain) continue
      // A merge cut off by the crash: abort it in the integration worktree only.
      const integ = missionGit.integrationPath(mission.repoPath, mission.name)
      if (existsSync(integ) && (await missionGit.git(integ, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { allowFail: true })).code === 0) {
        await missionGit.git(integ, ['merge', '--abort'], { allowFail: true })
        log.push(`${mission.name}: aborted a merge left half-done in the integration worktree`)
      }
      for (const agent of mission.agents.values()) {
        if (agent.status === 'exited' || agent.shutDown) continue
        await this.relaunch(mission, agent, log)
      }
      // Work committed but not yet merged (held by a pause, or cut off by the crash).
      for (const agent of mission.agents.values()) {
        if (agent.role === 'worker' && agent.merge === 'committed') {
          this.gitWork = this.gitWork.then(() => this.routeCommitted(mission, agent)).catch((err) => this.orcNote(mission, `merge error: ${String(err)}`))
        }
      }
      for (const line of log.filter((l) => l.startsWith(`${mission.name}`))) this.orcNote(mission, line, 'ok')
    }
    this.emit()
    return log
  }

  /** Brings one agent's session back: `claude --resume` when it had a turn, else a fresh start
   *  (workers get their task again). Appends what it did to `log`. */
  private async relaunch(mission: Mission, agent: Agent, log: string[]): Promise<void> {
    if (!existsSync(agent.cwd)) {
      agent.status = 'exited'
      agent.activity = 'worktree missing after restart'
      log.push(`${mission.name}/${agent.name}: worktree is gone, not resumed`)
      return
    }
    const hadTurn = !!agent.tally && existsSync(agent.tally.path)
    agent.dismissed = false
    agent.exitKind = null
    agent.exitCode = null
    // A turn cut off by the restart is over; questions and done stay as they were.
    // A session started fresh is "starting" until its new SessionStart, whatever it was.
    if (!hadTurn && !agent.question && agent.status !== 'done') {
      agent.status = 'starting'
      agent.activity = 'restarted'
    } else if (agent.status === 'working' || agent.status === 'starting' || (agent.status === 'needs-you' && !agent.question)) {
      agent.status = hadTurn ? 'idle' : 'starting'
      agent.activity = hadTurn ? 'resumed after restart' : 'restarted'
    }
    try {
      this.startSession(mission, agent, {
        systemPrompt: this.systemPromptFor(mission, agent),
        resume: hadTurn,
        firstPrompt: hadTurn || agent.role !== 'worker' ? undefined : agent.task
      })
    } catch (err) {
      // One agent that can't start must not stop the rest from coming back.
      agent.status = 'exited'
      agent.activity = `could not restart: ${String((err as Error).message ?? err)}`
      log.push(`${mission.name}/${agent.name}: could not restart (${String((err as Error).message ?? err)})`)
      return
    }
    if (agent.role === 'worker' && agent.branch) {
      const dirty = (await missionGit.git(agent.cwd, ['status', '--porcelain'], { allowFail: true })).stdout
      if (dirty) log.push(`${mission.name}/${agent.name}: worktree has uncommitted changes (kept)`)
    }
    log.push(`${mission.name}/${agent.name}: ${hadTurn ? 'resumed' : 'restarted'}`)
  }

  /** Brings a stopped mission back (Stop pressed by mistake): every session the Stop ended is
   *  resumed with its conversation. Workers shut down on their own stay down. Throws with the
   *  reason when it can't (the UI shows it). */
  async restartMission(id: string): Promise<void> {
    const m = this.missions.get(id)
    if (!m || m.state !== 'stopped') return
    if (m.mergedToMain) throw new Error('this mission was merged to main and its worktrees removed; start a new mission instead')
    const back = [...m.agents.values()].filter((a) => !a.shutDown)
    const live = this.liveIn(m.repoPath)
    const limit = this.liveLimitFor(m.repoPath)
    const wanted = back.filter((a) => a.status !== 'done').length
    if (live + wanted > limit) throw new Error(`restarting needs ${wanted} live agents and this space has ${live} of ${limit}. Stop or finish another mission first.`)
    // Stop only signals the processes: a terminal is running until its exit arrives. Wait for
    // them, or Restart right after Stop would skip them and their late exits undo the restart.
    for (const end = Date.now() + 8000; back.some((a) => this.terminals.isRunning(a.terminalId)); await new Promise((r) => setTimeout(r, 100))) {
      if (Date.now() > end) throw new Error('the stopped sessions have not exited yet. Try Restart again in a few seconds.')
    }
    if (m.state !== 'stopped') return
    m.state = 'running'
    const log: string[] = []
    for (const a of back) {
      // Stop marked unfinished agents exited; what they were doing is gone, so they come back
      // idle (or still asking, or done) the way a crash restart does.
      if (a.status === 'exited') a.status = a.doneSummary && a.merge !== 'conflict' ? 'done' : a.question ? 'needs-you' : 'working'
      a.waitingOn = a.question ? 'question' : null
      a.inTurn = false
      await this.relaunch(m, a, log)
    }
    this.feed(m, { kind: 'orc', from: 'you', to: null, text: `mission restarted: ${log.length ? log.map((l) => l.replace(`${m.name}/`, '')).join('; ') : 'no sessions to bring back'}`, status: 'ok' })
  }

  private update(terminalId: string, patch: Partial<Agent>): void {
    const agent = this.byTerminal.get(terminalId)
    if (!agent) return
    Object.assign(agent, patch)
    this.emit()
  }

  /** Coalesces bursts of hook events into one renderer update, and skips the update when the
   *  views are the same as the last one sent. */
  private emit(): void {
    if (this.emitTimer) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      const views = this.views()
      const json = JSON.stringify(views)
      if (json === this.lastViews) return
      this.lastViews = json
      this.changed(views)
    }, 30)
  }
}

function agentView(a: Agent): AgentView {
  return {
    name: a.name,
    sessionName: a.sessionName,
    role: a.role,
    parent: a.parent,
    task: a.task,
    status: a.status,
    activity: a.activity,
    lastInstructionBy: a.lastInstructionBy,
    lastInstructionAt: a.lastInstructionAt,
    branch: a.branch,
    cwd: a.cwd,
    sessionId: a.sessionId,
    terminalId: a.terminalId,
    question: a.question,
    doneSummary: a.doneSummary,
    tokens: a.tokens,
    contextTokens: a.contextTokens,
    startedAt: a.startedAt,
    merge: a.merge,
    conflictFiles: a.conflictFiles,
    ...(a.shutDown ? { shutDown: true } : {}),
    ...(a.dismissed ? { dismissed: true } : {}),
    ...(a.exitKind ? { exitKind: a.exitKind, exitCode: a.exitCode ?? null } : {})
  }
}

/** Defaults < space < mission. Legacy `model` (tests) is every role, with no advisor. */
function resolveModels(space: Partial<RoleModels>, req: StartMissionRequest): RoleModels {
  const legacy = req.model?.trim()
  if (legacy) return { ...(Object.fromEntries(ModelRoles.map((r) => [r, legacy])) as RoleModels), advisor: null }
  const merged: RoleModels = { ...DefaultRoleModels, ...space, ...req.models }
  for (const r of ModelRoles) merged[r] = merged[r]?.trim() || null
  return merged
}
