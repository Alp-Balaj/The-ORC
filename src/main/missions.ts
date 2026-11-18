import { randomBytes, randomUUID } from 'node:crypto'
import type { AgentView, FeedEntry, MissionView, StartMissionRequest } from '../shared/types.ts'
import { claudeArgs, coordinatorPrompt, sessionEnv, workerPrompt } from './claude-launch.ts'
import type { ControlHandlers, HookEvent } from './control-server.ts'
import * as gitOps from './git-worktrees.ts'
import type { TerminalHost } from './terminals.ts'
import { TranscriptTally } from './tokens.ts'

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
  git: Pick<typeof gitOps, 'addWorktree' | 'branchesUnder' | 'currentBranch' | 'repoRoot'> = gitOps

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
        tokens: agents.reduce((n, a) => n + a.tokens, 0)
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
      feed: []
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
      systemPrompt: coordinatorPrompt(name, sessionName, repo)
    })
    return mission.id
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
    if (a) this.feed(this.missions.get(a.missionId)!, { kind: 'done', from: a.name, to: a.parent, text: oneLine(summary) })
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
        const human = !cross && !isLaunch
        this.update(callerTerminal, {
          status: 'working',
          activity: cross ? `message from ${fromName}` : 'thinking',
          question: null,
          waitingOn: null,
          ...(cross && agent.role === 'worker' ? { lastInstructionBy: 'coordinator' as const, lastInstructionAt: Date.now() } : {}),
          ...(human ? { lastInstructionBy: 'you' as const, lastInstructionAt: Date.now() } : {})
        })
        if (cross) this.feed(mission, { kind: 'delivered', from: fromName!, to: agent.name, text: oneLine(cross.body) })
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
        if (!done && !asking) {
          this.update(callerTerminal, { status: 'needs-you', activity: e.message ?? 'needs you', waitingOn: 'permission' })
        }
        break
      case 'Stop':
        if (!done && !asking) this.update(callerTerminal, { status: 'idle', activity: 'turn finished', waitingOn: null })
        break
      case 'SessionEnd':
        this.update(callerTerminal, { status: 'exited', waitingOn: null })
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
      // "waiting" = at a permission prompt; it shows up here before the Notification hook does.
      if (states.get(agent.sessionId) === 'waiting' && agent.status === 'working') {
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
      waitingOn: null,
      idlePolls: 0,
      tally: null,
      notes: [],
      token,
      missionId: mission.id
    }
    delete (agent as Partial<typeof a>).systemPrompt
    delete (agent as Partial<typeof a>).firstPrompt
    mission.agents.set(a.name, agent)
    this.byToken.set(token, agent)
    this.byTerminal.set(terminalId, agent)
    const { command, args } = this.launcher(
      claudeArgs({
        sessionName: a.sessionName,
        sessionId: agent.sessionId,
        token,
        controlPort: this.controlPort,
        permissionMode: mission.permissionMode,
        model: mission.model,
        systemPrompt: a.systemPrompt,
        firstPrompt: a.firstPrompt
      })
    )
    this.terminals.start({ id: terminalId, command, args, cwd: a.cwd, env: sessionEnv() })
    this.emit()
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
    startedAt: a.startedAt
  }
}
