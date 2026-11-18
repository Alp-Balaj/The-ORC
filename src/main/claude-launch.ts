import type { PermissionMode } from '../shared/types'

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

export interface LaunchSpec {
  sessionName: string
  sessionId: string
  token: string
  controlPort: number
  permissionMode: PermissionMode
  model?: string | null
  systemPrompt: string
  firstPrompt?: string
}

function hookCommand(port: number, token: string): string {
  return (
    `curl -s -m 2 -o /dev/null -X POST -H 'Authorization: Bearer ${token}' ` +
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
    '--session-id', spec.sessionId,
    '--permission-mode', spec.permissionMode,
    ...(spec.model ? ['--model', spec.model] : []),
    '--settings', JSON.stringify(settings),
    '--append-system-prompt', spec.systemPrompt,
    '--mcp-config', JSON.stringify(mcp)
  ]
}

export function coordinatorPrompt(mission: string, sessionName: string, repo: string): string {
  return [
    `You are the coordinator of The ORC mission "${mission}" in the repository ${repo}.`,
    'The human talks to you here. When they ask for work that can be split, split it into',
    'parallel pieces and start a worker for each with the `mcp__orc__spawn_agent` tool',
    '(orc MCP server; if it is not loaded yet, load it with ToolSearch first).',
    'Each worker is a separate Claude Code session in its own git worktree and branch.',
    'Give every worker a clear, self-contained task that names the files or areas it owns,',
    'so parallel workers never edit the same files.',
    `Your session name is "${sessionName}". Workers report to you with SendMessage.`,
    'Wait for their reports instead of polling. Do not do splittable implementation work yourself.',
    'Never commit, merge, push or manage branches: The ORC handles git.',
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
