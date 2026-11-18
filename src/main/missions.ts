import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentView, DiffView, FeedEntry, GateView, Gating, MissionView, SplitView, StartMissionRequest, VerifierView } from '../shared/types.ts'
import { claudeArgs, coordinatorPrompt, sessionEnv, workerPrompt } from './claude-launch.ts'
import type { ControlHandlers, HookEvent } from './control-server.ts'
import * as gitOps from './git-worktrees.ts'
import type { TerminalHost } from './terminals.ts'
import { TranscriptTally } from './tokens.ts'
import * as missionGit from './mission-git.ts'
import { runVerifier, templateHash } from './verifier.ts'
import { appendRecord } from './vault.ts'

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
}

export interface SavedState {
  version: 1
  savedAt: number
  missions: (Omit<Mission, 'agents' | 'held'> & { agents: (AgentView & { transcriptPath: string | null; pid: number | null; notes: string[] })[] })[]
}

interface Mission {
  id: string
  name: string
  repoPath: string
  baseBranch: string
  permissionMode: StartMissionRequest['permissionMode']
  model: string | null
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
  if (file) return `${name} ${file.split('/').slice(-2).join('/')}`
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
  /** Most agents one mission may have, coordinator included (M4 makes this per space). */
  maxAgentsPerMission = 8
  /** How a session is started. Tests swap in a fake command. */
  launcher: Launcher = (args) => ({ command: 'claude', args })
  /** Git operations. Tests swap in fakes. */
  git: Pick<typeof gitOps, 'addWorktree' | 'branchesUnder' | 'currentBranch' | 'repoRoot'> &
    Pick<typeof missionGit, 'commitAll' | 'ensureIntegration' | 'mergeIntoIntegration' | 'runGate' | 'combinedDiff' | 'mergeToMain' | 'cleanupMission' | 'branchDiff' | 'prepareConflict'> = { ...gitOps, ...missionGit }

  private readonly terminals: TerminalHost
  private readonly changed: (missions: MissionView[]) => void

  constructor(terminals: TerminalHost, changed: (missions: MissionView[]) => void) {
    this.terminals = terminals
    this.changed = changed
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
        model: m.model,
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
    const mission: Mission = {
      id: randomUUID(),
      name,
      repoPath: repo,
      baseBranch: await this.git.currentBranch(repo),
      permissionMode: req.permissionMode,
      model: req.model?.trim() || null,
      state: 'running',
      createdAt: Date.now(),
      agents: new Map(),
      feed: [],
      gating: req.gating ?? 'plan',
      split: null,
      merged: [],
      integrationCommit: null,
      gate: null,
      verifier: null,
      mergedToMain: null,
      brief: null,
      paused: false,
      held: []
    }
    this.missions.set(mission.id, mission)
    const sessionName = `${name}/coordinator`
    this.launch(mission, {
      name: 'coordinator',
      sessionName,
      role: 'coordinator',
      parent: null,
      task: '',
      cwd: repo,
      branch: mission.baseBranch,
      systemPrompt: coordinatorPrompt(name, sessionName, repo, mission.gating)
    })
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
    if (mission.agents.size >= this.maxAgentsPerMission) {
      return `This mission already has ${mission.agents.size} agents, the most allowed. Reuse an existing worker by messaging it.`
    }
    const wt = await this.git.addWorktree(mission.repoPath, mission.name, name, mission.baseBranch)
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
    return this.git.branchDiff(mission.repoPath, mission.baseBranch, a.branch)
  }

  async missionDiff(missionId: string): Promise<DiffView | null> {
    const mission = this.missions.get(missionId)
    if (!mission || mission.merged.length === 0) return null
    return this.git.combinedDiff(mission.repoPath, mission.name, mission.baseBranch)
  }

  /** Runs the space's gate command on the merged result. */
  async runGate(missionId: string, command: string | null): Promise<void> {
    const mission = this.missions.get(missionId)
    if (!mission || mission.merged.length === 0 || !command) return
    mission.gate = { command, ok: false, exitCode: null, output: 'running…', at: Date.now() }
    this.emit()
    mission.gate = await this.git.runGate(missionGit.integrationPath(mission.repoPath, mission.name), command)
    this.feed(mission, { kind: 'gate', from: 'orc', to: null, text: `${command}: ${mission.gate.ok ? 'passed' : `failed (exit ${mission.gate.exitCode})`}`, status: mission.gate.ok ? 'ok' : 'failed' })
  }

  async runVerifier(missionId: string): Promise<void> {
    const mission = this.missions.get(missionId)
    if (!mission || mission.merged.length === 0 || mission.verifier?.status === 'running') return
    const diff = await this.git.combinedDiff(mission.repoPath, mission.name, mission.baseBranch)
    mission.verifier = { status: 'running', report: '', templateHash, promptHash: '', at: Date.now(), integrationCommit: mission.integrationCommit }
    this.emit()
    const r = await this.verify({
      cwd: missionGit.integrationPath(mission.repoPath, mission.name),
      model: mission.model,
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
  }

  /** How the Verifier runs. Tests swap in a fake. */
  verify = runVerifier

  /** The human pressed Merge to main. */
  async mergeToMain(missionId: string): Promise<{ ok: boolean; message: string }> {
    const mission = this.missions.get(missionId)
    if (!mission) return { ok: false, message: 'no such mission' }
    if (mission.merged.length === 0) return { ok: false, message: 'Nothing is merged into the integration branch yet.' }
    const r = await this.git.mergeToMain(mission.repoPath, mission.name, mission.baseBranch)
    if (!r.ok) {
      this.feed(mission, { kind: 'main', from: 'you', to: null, text: `merge to ${mission.baseBranch} refused: ${oneLine(r.reason)}`, status: 'failed' })
      return { ok: false, message: r.reason }
    }
    mission.mergedToMain = { commit: r.commit, at: Date.now() }
    this.record(mission, `Merged into ${mission.baseBranch}`, `Commit \`${r.commit}\`.\n\nSessions (reopen with \`claude --resume <id>\`):\n${[...mission.agents.values()].map((x) => `- ${x.sessionName}: \`${x.sessionId}\``).join('\n')}`)
    this.feed(mission, { kind: 'main', from: 'you', to: null, text: `merged into ${mission.baseBranch} at ${r.commit.slice(0, 8)}`, status: 'ok' })
    // The work is in main: end the sessions, then remove worktrees and branches.
    this.stopMission(mission.id)
    const workers = [...mission.agents.values()].filter((x) => x.role === 'worker' && x.branch)
    const merged = workers.filter((x) => x.merge === 'merged' && mission.merged.includes(x.name))
    const kept = workers.filter((x) => !merged.includes(x))
    await this.git.cleanupMission(mission.repoPath, mission.name, merged.map((x) => ({ path: x.cwd, branch: x.branch! })))
    const keptNote = kept.length ? ` Kept (not merged): ${kept.map((x) => `${x.name} on ${x.branch}`).join(', ')}.` : ''
    if (kept.length) this.orcNote(mission, `not merged, worktrees kept: ${kept.map((x) => x.name).join(', ')}`)
    return { ok: true, message: `Merged into ${mission.baseBranch} at ${r.commit.slice(0, 8)}. Merged workers' worktrees and branches removed.${keptNote}` }
  }

  askHuman(callerTerminal: string, question: string): void {
    const a = this.byTerminal.get(callerTerminal)
    this.update(callerTerminal, { status: 'needs-you', activity: 'asked you a question', question, waitingOn: 'question' })
    if (a) this.feed(this.missions.get(a.missionId)!, { kind: 'question', from: a.name, to: 'you', text: oneLine(question) })
  }

  /** Applies one hook event. Returns the hook's stdout: JSON carrying queued notes as
   *  additionalContext (PreToolUse and UserPromptSubmit accept it), or null for nothing. */
  hookEvent(callerTerminal: string, e: HookEvent): string | null {
    const agent = this.byTerminal.get(callerTerminal)
    if (!agent) return null
    const mission = this.missions.get(agent.missionId)!
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
        const human = !cross && !isLaunch && !fromOrc
        if (human && agent.role === 'coordinator' && !mission.brief) mission.brief = e.prompt ?? null
        this.update(callerTerminal, {
          status: 'working',
          activity: cross ? `message from ${fromName}` : 'thinking',
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
    if ((e.hook_event_name === 'PreToolUse' || e.hook_event_name === 'UserPromptSubmit') && agent.notes.length) {
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
      this.update(terminalId, { lastInstructionBy: 'you', lastInstructionAt: Date.now() })
    }
  }

  terminalExited(terminalId: string): void {
    const a = this.byTerminal.get(terminalId)
    if (a && a.status !== 'done') this.update(terminalId, { status: 'exited' })
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

  private async mergeWorker(mission: Mission, a: Agent): Promise<void> {
    await this.git.ensureIntegration(mission.repoPath, mission.name, mission.baseBranch)
    const r = await this.git.mergeIntoIntegration(mission.repoPath, mission.name, a.branch!, `Merge ${a.name} into ${missionGit.integrationBranch(mission.name)}`)
    if (r.kind === 'conflict') {
      a.merge = 'conflict'
      a.conflictFiles = r.files
      this.feed(mission, { kind: 'conflict', from: a.name, to: 'coordinator', text: `conflicts with ${missionGit.integrationBranch(mission.name)} in ${r.files.join(', ')}`, status: 'failed' })
      // Leave the conflict in the worker's own worktree for it to resolve; its next
      // report_done commits the resolution and the merge is retried.
      await this.git.prepareConflict(mission.repoPath, a.cwd, missionGit.integrationBranch(mission.name))
      const coord = [...mission.agents.values()].find((x) => x.role === 'coordinator')
      this.deliver(a, `[The ORC] Your branch conflicts with work already merged (${r.files.join(', ')}). The conflict markers are now in your worktree. Edit the files to resolve them so both changes survive. Run no git commands (The ORC stages and commits), then call report_done again.`)
      if (coord) this.deliver(coord, `[The ORC] ${a.name}'s work conflicts with already-merged work in ${r.files.join(', ')}. ${a.name} has been asked to resolve it; step in if it needs direction.`)
      // Its work is not done any more: it has a conflict to resolve. Without this, "done" is
      // sticky and a permission prompt during the resolution never shows as needs-you.
      a.status = 'working'
      a.activity = 'resolving a conflict'
      this.emit()
      return
    }
    a.merge = 'merged'
    a.conflictFiles = []
    if (!mission.merged.includes(a.name)) mission.merged.push(a.name)
    if (r.kind === 'merged') {
      mission.integrationCommit = r.commit
      this.feed(mission, { kind: 'merge', from: a.name, to: null, text: `merged into ${missionGit.integrationBranch(mission.name)}`, status: 'ok' })
      const gate = this.gateCommandFor(mission.repoPath)
      if (gate) await this.runGate(mission.id, gate)
    }
    this.emit()
  }

  /** A space's mission-records folder, or null (off). index.ts wires this to Spaces. */
  recordsDirFor: (repo: string) => string | null = () => null

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
      missionId: mission.id
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
        model: mission.model,
        systemPrompt: o.systemPrompt,
        firstPrompt: o.firstPrompt
      })
    )
    this.terminals.start({ id: agent.terminalId, command, args, cwd: agent.cwd, env: sessionEnv() })
    agent.pid = this.terminals.pid(agent.terminalId)
    this.emit()
  }

  private systemPromptFor(mission: Mission, a: Agent): string {
    if (a.role === 'coordinator') return coordinatorPrompt(mission.name, a.sessionName, mission.repoPath, mission.gating)
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
        model: m.model, state: m.state, createdAt: m.createdAt, feed: m.feed.slice(-MaxFeed), gating: m.gating,
        split: m.split, merged: m.merged, integrationCommit: m.integrationCommit, gate: m.gate,
        verifier: m.verifier?.status === 'running' ? null : m.verifier, mergedToMain: m.mergedToMain, brief: m.brief, paused: m.paused, recorded: m.recorded,
        agents: [...m.agents.values()].map((a) => ({
          ...agentView(a),
          transcriptPath: a.tally?.path ?? null,
          pid: a.pid ?? null,
          notes: a.notes
        }))
      }))
    }
  }

  /** Brings saved missions back. Running missions' live agents are reattached with
   *  `claude --resume` (or started fresh if they never had a turn). Returns what it did. */
  async restore(saved: SavedState, opts: { isOrphan: (pid: number, sessionId: string) => boolean; kill: (pid: number) => void }): Promise<string[]> {
    const log: string[] = []
    if (saved?.version !== 1) return log
    for (const sm of saved.missions) {
      if (this.missions.has(sm.id)) continue
      const { agents: savedAgents, ...rest } = sm
      const mission: Mission = { ...rest, agents: new Map(), held: [] }
      this.missions.set(mission.id, mission)
      this.feedSeq = Math.max(this.feedSeq, ...mission.feed.map((f) => f.id))
      for (const sa of savedAgents) {
        const { transcriptPath, pid, notes, ...view } = sa
        const agent: Agent = {
          ...view,
          waitingOn: view.question ? 'question' : null,
          idlePolls: 0,
          tally: transcriptPath ? new TranscriptTally(transcriptPath) : null,
          notes: notes ?? [],
          inTurn: false,
          token: '',
          missionId: mission.id,
          pid: null
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
        if (agent.status === 'exited') continue
        if (!existsSync(agent.cwd)) {
          agent.status = 'exited'
          agent.activity = 'worktree missing after restart'
          log.push(`${mission.name}/${agent.name}: worktree is gone, not resumed`)
          continue
        }
        const hadTurn = !!agent.tally && existsSync(agent.tally.path)
        // A turn cut off by the restart is over; questions and done stay as they were.
        if (agent.status === 'working' || agent.status === 'starting' || (agent.status === 'needs-you' && !agent.question)) {
          agent.status = hadTurn ? 'idle' : 'starting'
          agent.activity = hadTurn ? 'resumed after restart' : 'restarted'
        }
        this.startSession(mission, agent, {
          systemPrompt: this.systemPromptFor(mission, agent),
          resume: hadTurn,
          firstPrompt: hadTurn || agent.role !== 'worker' ? undefined : agent.task
        })
        if (agent.role === 'worker' && agent.branch) {
          const dirty = (await missionGit.git(agent.cwd, ['status', '--porcelain'], { allowFail: true })).stdout
          if (dirty) log.push(`${mission.name}/${agent.name}: worktree has uncommitted changes (kept)`)
        }
        log.push(`${mission.name}/${agent.name}: ${hadTurn ? 'resumed' : 'restarted'}`)
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

  private update(terminalId: string, patch: Partial<Agent>): void {
    const agent = this.byTerminal.get(terminalId)
    if (!agent) return
    Object.assign(agent, patch)
    this.emit()
  }

  /** Coalesces bursts of hook events into one renderer update. */
  private emit(): void {
    if (this.emitTimer) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      this.changed(this.views())
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
    conflictFiles: a.conflictFiles
  }
}
