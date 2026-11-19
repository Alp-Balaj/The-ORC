import type { Gating, PermissionMode } from '../shared/types.ts'

/** Git write commands no ORC session may run: The ORC commits and merges. */
export const DeniedGitWrites = [
  'Bash(git commit*)',
  'Bash(git push*)',
  'Bash(git merge*)',
  'Bash(git rebase*)',
  'Bash(git reset*)',
  'Bash(git checkout*)',
  'Bash(git switch*)',
  'Bash(git restore*)',
  'Bash(git clean*)',
  'Bash(git worktree*)',
  'Bash(git branch -D*)'
]

/** Pre-approved so the mission's own plumbing never stops on a permission prompt. */
const OrcTools = [
  'mcp__orc__spawn_agent',
  'mcp__orc__report_done',
  'mcp__orc__ask_human',
  'mcp__orc__propose_split',
  'mcp__orc__stop_agent',
  'SendMessage',
  'ListAgents'
]

const HookEvents = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'Stop',
  'SessionEnd'
]

/** Variables that mark a process as running *inside* a Claude Code session. If The ORC was
 *  started from one (a terminal tab inside Claude Code, or an agent testing it), its sessions
 *  inherit them and attach to that outer session's messaging socket: SendMessage then can't
 *  find mission peers ("no agent named … is reachable"), ListAgents shows the outer session,
 *  and transcripts are off. Every ORC session starts without them. */
export function isInheritedSessionVar(name: string): boolean {
  return (
    name === 'CLAUDECODE' ||
    name === 'CLAUDE_PID' ||
    name === 'CLAUDE_EFFORT' ||
    /^CLAUDE_CODE_(SESSION|CHILD|MESSAGING|ENTRYPOINT|EXECPATH|SSE_PORT)/.test(name)
  )
}

export function sessionEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(base)) if (v !== undefined && !isInheritedSessionVar(k)) env[k] = v
  return env
}

export interface LaunchSpec {
  sessionName: string
  sessionId: string
  /** Reattach to this session's conversation (after a restart) instead of starting it. */
  resume?: boolean
  token: string
  controlPort: number
  permissionMode: PermissionMode
  model?: string | null
  systemPrompt: string
  firstPrompt?: string
}

function hookCommand(port: number, token: string): string {
  return (
    // stdout carries the app's reply (additionalContext notes); empty for most events.
    `curl -sf -m 2 -X POST -H 'Authorization: Bearer ${token}' ` +
    `-H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:${port}/hook || true`
  )
}

export function claudeArgs(spec: LaunchSpec): string[] {
  const hook = { type: 'command', command: hookCommand(spec.controlPort, spec.token) }
  const settings = {
    permissions: { allow: OrcTools, deny: DeniedGitWrites },
    hooks: Object.fromEntries(
      HookEvents.map((event) => [event, [{ matcher: '*', hooks: [hook] }]])
    )
  }
  const mcp = {
    mcpServers: {
      orc: {
        type: 'http',
        url: `http://127.0.0.1:${spec.controlPort}/mcp`,
        headers: { Authorization: `Bearer ${spec.token}` }
      }
    }
  }
  // The prompt goes first: --mcp-config is variadic and would swallow a trailing positional.
  return [
    ...(spec.firstPrompt ? [spec.firstPrompt] : []),
    '--name', spec.sessionName,
    ...(spec.resume ? ['--resume', spec.sessionId] : ['--session-id', spec.sessionId]),
    '--permission-mode', spec.permissionMode,
    ...(spec.model ? ['--model', spec.model] : []),
    '--settings', JSON.stringify(settings),
    '--append-system-prompt', spec.systemPrompt,
    '--mcp-config', JSON.stringify(mcp)
  ]
}

export function coordinatorPrompt(mission: string, sessionName: string, repo: string, gating: Gating = 'plan'): string {
  const gate =
    gating === 'plan'
      ? [
          'This mission uses PLAN CHECK. Before spawning anything, call `mcp__orc__propose_split` with a',
          'one-line summary and the workers you intend (name + task each), then END YOUR TURN.',
          'The human approves or rejects it in The ORC; you then get a message starting with [The ORC].',
          'spawn_agent refuses until the split is approved.'
        ]
      : gating === 'checkpointed'
        ? ['This mission is CHECKPOINTED: the human reviews each worker\'s diff before it merges. Spawn workers directly.']
        : ['Spawn workers directly with spawn_agent.']
  return [
    `You are the coordinator of The ORC mission "${mission}" in the repository ${repo}.`,
    'The human talks to you here. When they ask for work that can be split, split it into',
    'parallel pieces and start a worker for each with the `mcp__orc__spawn_agent` tool',
    '(orc MCP server; if it is not loaded yet, load it with ToolSearch first).',
    ...gate,
    'Each worker is a separate Claude Code session in its own git worktree and branch.',
    'Give every worker a clear, self-contained task that names the files or areas it owns,',
    'so parallel workers never edit the same files.',
    `Your session name is "${sessionName}". Workers report to you with SendMessage.`,
    'Wait for their reports instead of polling. Do not do splittable implementation work yourself.',
    'Once a worker has reported done, its work is merged and you have no further use for it, you may',
    'shut its session down with `mcp__orc__stop_agent` to free resources. A stopped worker cannot be',
    'messaged again, so keep any worker you may still send follow-up work to.',
    'Never commit, merge, push or manage branches: The ORC commits each worker\'s work when it reports',
    'done and merges it into the mission\'s integration branch; the human merges to main.',
    'Messages starting with [The ORC] come from the app, not the human.',
    'The human can type into any worker directly. If they are steering a worker, do not override them.'
  ].join(' ')
}

export function workerPrompt(mission: string, sessionName: string, coordinator: string): string {
  return [
    `You are worker "${sessionName}" in The ORC mission "${mission}".`,
    `Your coordinator is the Claude Code session named "${coordinator}".`,
    'Work only inside your current directory (your own git worktree).',
    'Never commit, merge, push or manage branches: The ORC commits for you.',
    'When your task is finished, call the `mcp__orc__report_done` tool (orc MCP server; load it',
    'with ToolSearch first if needed) with a short summary of what you changed, then send the',
    'same summary to your coordinator with SendMessage.',
    'If you are blocked on a decision only a human can make, call `mcp__orc__ask_human` and end your turn.',
    'The human may type to you directly; their instructions win over the coordinator.'
  ].join(' ')
}
