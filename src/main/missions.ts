import { randomBytes, randomUUID } from 'node:crypto'
import type { AgentView, MissionView, StartMissionRequest } from '../shared/types'
import { claudeArgs, coordinatorPrompt, workerPrompt } from './claude-launch'
import type { ControlHandlers, HookEvent } from './control-server'
import { addWorktree, currentBranch, repoRoot } from './git-worktrees'
import type { TerminalHost } from './terminals'

interface Agent extends AgentView {
  token: string
  missionId: string
}

interface Mission {
  id: string
  name: string
  repoPath: string
  baseBranch: string
  permissionMode: StartMissionRequest['permissionMode']
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
      agents: [...m.agents.values()].map(({ token: _t, missionId: _m, ...view }) => view)
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
    this.update(callerTerminal, { status: 'done', doneSummary: summary, question: null })
  }

  askHuman(callerTerminal: string, question: string): void {
    this.update(callerTerminal, { status: 'needs-you', question })
  }

  hookEvent(callerTerminal: string, e: HookEvent): void {
    const agent = this.byTerminal.get(callerTerminal)
    if (!agent) return
    // A finished or questioning agent stays so until it starts a new turn.
    const sticky = agent.status === 'done' || agent.status === 'needs-you'
    switch (e.hook_event_name) {
      case 'SessionStart':
        if (agent.status === 'starting') this.update(callerTerminal, { status: 'idle' })
        break
      case 'UserPromptSubmit':
        this.update(callerTerminal, { status: 'working', activity: 'thinking', question: null })
        break
      case 'PreToolUse':
        this.update(callerTerminal, {
          ...(sticky ? {} : { status: 'working' as const }),
          activity: describeTool(e.tool_name, e.tool_input)
        })
        break
      case 'Notification':
        // Permission prompts and "waiting for input" both mean the human is needed.
        if (agent.status !== 'done') {
          this.update(callerTerminal, {
            status: 'needs-you',
            activity: e.message ?? 'needs you'
          })
        }
        break
      case 'Stop':
        if (!sticky) this.update(callerTerminal, { status: 'idle', activity: 'turn finished' })
        break
      case 'SessionEnd':
        this.update(callerTerminal, { status: 'exited' })
        break
    }
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
        systemPrompt: a.systemPrompt,
        firstPrompt: a.firstPrompt
      }),
      cwd: a.cwd
    })
    this.changed(this.views())
  }

  private update(terminalId: string, patch: Partial<AgentView>): void {
    const agent = this.byTerminal.get(terminalId)
    if (!agent) return
    Object.assign(agent, patch)
    this.changed(this.views())
  }
}
