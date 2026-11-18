import { randomBytes, randomUUID } from 'node:crypto'
import type { AgentView, MissionView, StartMissionRequest } from '../shared/types.ts'
import { claudeArgs, coordinatorPrompt, sessionEnv, workerPrompt } from './claude-launch.ts'
import type { ControlHandlers, HookEvent } from './control-server.ts'
import { addWorktree, currentBranch, repoRoot } from './git-worktrees.ts'
import type { TerminalHost } from './terminals.ts'

interface Agent extends AgentView {
  token: string
  missionId: string
  /** Why the agent is needs-you: a permission prompt clears when the tool runs or the
   *  session goes idle; a question (ask_human) clears only when a new turn starts. */
  waitingOn: 'permission' | 'question' | null
  /** Consecutive `claude agents` polls that saw this session idle while we thought it busy. */
  idlePolls: number
}

interface Mission {
  id: string
  name: string
  repoPath: string
  baseBranch: string
  permissionMode: StartMissionRequest['permissionMode']
  model: string | null
  agents: Map<string, Agent>
}

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'mission'

function describeTool(name: string | undefined, input: Record<string, unknown> | undefined): string {
  if (!name) return ''
  const pick = (k: string): string | undefined =>
    typeof input?.[k] === 'string' ? (input[k] as string) : undefined
  const file = pick('file_path') ?? pick('path') ?? pick('notebook_path')
  if (file) return `${name} ${file.split('/').slice(-2).join('/')}`
  const cmd = pick('command')
  if (cmd) return `${name}: ${cmd.slice(0, 60)}`
  if (name.startsWith('mcp__orc__')) return name.replace('mcp__orc__', 'orc: ')
  return name
}

/** Owns missions and their agents: launches sessions, maps tokens to agents,
 *  and turns hook events into status the UI shows. */
export class Missions implements ControlHandlers {
  private readonly missions = new Map<string, Mission>()
  private readonly byToken = new Map<string, Agent>()
  private readonly byTerminal = new Map<string, Agent>()
  private controlPort = 0
  /** Most agents one mission may have, coordinator included (M4 makes this per space). */
  maxAgentsPerMission = 8

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
    return [...this.missions.values()].map((m) => ({
      id: m.id,
      name: m.name,
      repoPath: m.repoPath,
      baseBranch: m.baseBranch,
      permissionMode: m.permissionMode,
      model: m.model,
      agents: [...m.agents.values()].map(({ token: _t, missionId: _m, waitingOn: _w, idlePolls: _i, ...view }) => view)
    }))
  }

  async startMission(req: StartMissionRequest): Promise<string> {
    const repo = await repoRoot(req.repoPath)
    const name = slug(req.name)
    if ([...this.missions.values()].some((m) => m.repoPath === repo && m.name === name)) {
      throw new Error(`mission "${name}" already exists in ${repo}`)
    }
    const mission: Mission = {
      id: randomUUID(),
      name,
      repoPath: repo,
      baseBranch: await currentBranch(repo),
      permissionMode: req.permissionMode,
      model: req.model?.trim() || null,
      agents: new Map()
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

  // ControlHandlers ---------------------------------------------------------

  agentForToken(token: string): string | null {
    return this.byToken.get(token)?.terminalId ?? null
  }

  async spawnAgent(callerTerminal: string, rawName: string, task: string): Promise<string> {
    const caller = this.byTerminal.get(callerTerminal)
    if (!caller) throw new Error('unknown caller')
    const mission = this.missions.get(caller.missionId)!
    const name = slug(rawName)
    if (mission.agents.has(name)) {
      return `A worker named "${name}" already exists in this mission. Pick another name.`
    }
    if (mission.agents.size >= this.maxAgentsPerMission) {
      return `This mission already has ${mission.agents.size} agents, the most allowed. Reuse an existing worker by messaging it.`
    }
    const wt = await addWorktree(mission.repoPath, mission.name, name, mission.baseBranch)
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
    return (
      `Started worker "${sessionName}" on branch ${wt.branch}. ` +
      `It will report to you with SendMessage; message it by that name.`
    )
  }

  reportDone(callerTerminal: string, summary: string): void {
    this.update(callerTerminal, { status: 'done', activity: 'reported done', doneSummary: summary, question: null, waitingOn: null })
  }

  askHuman(callerTerminal: string, question: string): void {
    this.update(callerTerminal, { status: 'needs-you', activity: 'asked you a question', question, waitingOn: 'question' })
  }

  hookEvent(callerTerminal: string, e: HookEvent): void {
    const agent = this.byTerminal.get(callerTerminal)
    if (!agent) return
    const done = agent.status === 'done'
    const asking = agent.waitingOn === 'question'
    switch (e.hook_event_name) {
      case 'SessionStart':
        if (agent.status === 'starting') this.update(callerTerminal, { status: 'idle', activity: 'ready' })
        break
      case 'UserPromptSubmit': {
        // A new turn: from the human, or a cross-session message from another agent.
        const from = /<cross-session-message[^>]*from-name="([^"]+)"/.exec(e.prompt ?? '')?.[1]
        this.update(callerTerminal, {
          status: 'working',
          activity: from ? `message from ${from.split('/').pop()}` : 'thinking',
          question: null,
          waitingOn: null,
          ...(from && agent.role === 'worker' ? { lastInstructionBy: 'coordinator' as const, lastInstructionAt: Date.now() } : {})
        })
        break
      }
      case 'PreToolUse':
      case 'PostToolUse':
        // A tool running means any permission prompt was answered yes.
        this.update(callerTerminal, {
          ...(done || asking ? {} : { status: 'working' as const, waitingOn: null }),
          activity: describeTool(e.tool_name, e.tool_input)
        })
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
  }

  /** Backup status from `claude agents --json` (interactive sessions: busy | idle | waiting).
   *  Hooks miss some transitions: pressing Esc on a permission prompt interrupts the turn and
   *  fires no hook at all. A session reported idle
   *  on two polls in a row while we think it is working or at a permission prompt is idle. */
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

  // Terminal side -----------------------------------------------------------

  /** Typing Enter in a worker's terminal counts as an instruction from the human. */
  noteHumanInput(terminalId: string, data: string): void {
    if (data.includes('\r')) {
      this.update(terminalId, { lastInstructionBy: 'you', lastInstructionAt: Date.now() })
    }
  }

  terminalExited(terminalId: string): void {
    this.update(terminalId, { status: 'exited' })
  }

  shutdown(): void {
    this.terminals.killAll()
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
      name: a.name,
      sessionName: a.sessionName,
      role: a.role,
      parent: a.parent,
      task: a.task,
      cwd: a.cwd,
      branch: a.branch,
      status: 'starting',
      activity: 'starting',
      lastInstructionBy: a.role === 'worker' ? 'coordinator' : null,
      lastInstructionAt: a.role === 'worker' ? Date.now() : null,
      sessionId: randomUUID(),
      terminalId,
      question: null,
      doneSummary: null,
      waitingOn: null,
      idlePolls: 0,
      token,
      missionId: mission.id
    }
    mission.agents.set(a.name, agent)
    this.byToken.set(token, agent)
    this.byTerminal.set(terminalId, agent)
    this.terminals.start({
      id: terminalId,
      command: 'claude',
      args: claudeArgs({
        sessionName: a.sessionName,
        sessionId: agent.sessionId,
        token,
        controlPort: this.controlPort,
        permissionMode: mission.permissionMode,
        model: mission.model,
        systemPrompt: a.systemPrompt,
        firstPrompt: a.firstPrompt
      }),
      cwd: a.cwd,
      env: sessionEnv()
    })
    this.changed(this.views())
  }

  private update(terminalId: string, patch: Partial<Agent>): void {
    const agent = this.byTerminal.get(terminalId)
    if (!agent) return
    Object.assign(agent, patch)
    this.changed(this.views())
  }
}
