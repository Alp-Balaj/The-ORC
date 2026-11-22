import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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
  'mcp__orc__search_history',
  'mcp__orc__add_to_queue',
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
  /** Model for Agent-tool subagents (CLAUDE_CODE_SUBAGENT_MODEL, via the settings `env` key). */
  subagentModel?: string | null
  /** Model for the server-side advisor tool, as an alias ("fable", "opus") or a full id. */
  advisorModel?: string | null
  /** Status line that posts Claude Code's status JSON (rate limits etc.) to the app. Default on. */
  statusLine?: boolean
  /** The owner's own status line command (ownerStatusLine), chained before the app's text. */
  ownStatusLine?: string | null
  systemPrompt: string
  firstPrompt?: string
  /** Folders outside the session's cwd it may read without a prompt (mission records). */
  readDirs?: string[]
}

/** A Read permission rule for an absolute folder. Claude Code writes absolute paths with a
 *  leading `//`, and Windows paths in POSIX form (`C:\x` → `//c/x`). */
export function readRule(dir: string): string {
  const posix = dir.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`).replace(/\/+$/, '')
  return `Read(/${posix.startsWith('/') ? posix : `/${posix}`}/**)`
}

/** The owner's own `statusLine` command from user, project and local settings (later wins),
 *  read-only; null when none is set, it isn't a command, or it is our own. */
export function ownerStatusLine(cwd: string, home = os.homedir()): string | null {
  let found: unknown = undefined
  for (const file of [
    path.join(home, '.claude', 'settings.json'),
    path.join(cwd, '.claude', 'settings.json'),
    path.join(cwd, '.claude', 'settings.local.json')
  ]) {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (parsed && typeof parsed === 'object' && 'statusLine' in parsed) found = (parsed as { statusLine: unknown }).statusLine
    } catch {
      // missing or invalid: skip
    }
  }
  if (!found || typeof found !== 'object') return null
  const { type, command } = found as { type?: unknown; command?: unknown }
  if (type !== 'command' || typeof command !== 'string' || !command.trim()) return null
  return command.includes('OrcStatusLine') ? null : command
}

function hookCommand(port: number, token: string): string {
  return (
    // stdout carries the app's reply (additionalContext notes); empty for most events.
    `curl -sf -m 2 -X POST -H 'Authorization: Bearer ${token}' ` +
    `-H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:${port}/hook || true`
  )
}

/** Posts the status-line stdin JSON to /hook, wrapped as an OrcStatusLine event; curl's stdout
 *  (the app's reply, often empty) becomes the status line text. */
function statusLineCommand(port: number, token: string, own?: string | null): string {
  if (own) {
    // Chain: the owner's own status line runs with the same stdin while the POST runs in the
    // background (bounded by -m 1); the app's text, if any, is appended after ` · `.
    const quoted = own.replace(/'/g, `'\\''`)
    return (
      `in=$(cat); t=$(mktemp 2>/dev/null) || t=/dev/null; ` +
      `{ printf '{"hook_event_name":"OrcStatusLine","status":%s}' "$in" | ` +
      `curl -s -m 1 -X POST -H 'Authorization: Bearer ${token}' ` +
      `-H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:${port}/hook ` +
      `>"$t" 2>/dev/null; } & p=$!; ` +
      `o=$(printf '%s' "$in" | sh -c '${quoted}'); ` +
      `wait $p 2>/dev/null; r=$(cat "$t" 2>/dev/null); [ "$t" = /dev/null ] || rm -f "$t"; ` +
      `if [ -z "$r" ]; then printf '%s' "$o"; elif [ -z "$o" ]; then printf '%s' "$r"; ` +
      `else printf '%s · %s' "$o" "$r"; fi`
    )
  }
  return (
    `{ printf '{"hook_event_name":"OrcStatusLine","status":'; cat; printf '}'; } | ` +
    `curl -s -m 2 -X POST -H 'Authorization: Bearer ${token}' ` +
    `-H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:${port}/hook || true`
  )
}

export function claudeArgs(spec: LaunchSpec): string[] {
  const hook = { type: 'command', command: hookCommand(spec.controlPort, spec.token) }
  const settings = {
    permissions: { allow: [...OrcTools, ...(spec.readDirs ?? []).map(readRule)], deny: DeniedGitWrites },
    hooks: Object.fromEntries(
      HookEvents.map((event) => [event, [{ matcher: '*', hooks: [hook] }]])
    ),
    ...(spec.subagentModel ? { env: { CLAUDE_CODE_SUBAGENT_MODEL: spec.subagentModel } } : {}),
    ...(spec.advisorModel ? { advisorModel: spec.advisorModel } : {}),
    ...(spec.statusLine !== false
      ? { statusLine: { type: 'command', command: statusLineCommand(spec.controlPort, spec.token, spec.ownStatusLine) } }
      : {})
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

/** Speed rules every lead passes on to its subagents (they don't see the lead's system prompt). */
export const SpeedRules =
  'Make the smallest change that does the job. Do not write or run tests, e2e tests or full builds ' +
  'unless the task explicitly asks. At most, check that what you touched compiles. Never run git ' +
  'commands that write. Finish as soon as it works.'

export function coordinatorPrompt(mission: string, sessionName: string, repo: string, gating: Gating = 'none', pastRecords: string[] = []): string {
  const past = pastRecords.length
    ? [
        'Earlier missions in this repository (newest first) record what was built and why. Before',
        'splitting the work, call `mcp__orc__search_history` with a query about the request; Read a',
        'record file only when its snippets are not enough:',
        pastRecords.map((p) => `"${p}"`).join(', ') + '.'
      ]
    : []
  const gate =
    gating === 'plan'
      ? [
          'This mission uses PLAN CHECK. Before spawning anything, call `mcp__orc__propose_split` with a',
          'one-line summary and the team leads you intend (name + task each), then END YOUR TURN.',
          'The human approves or rejects it in The ORC; you then get a message starting with [The ORC].',
          'spawn_agent refuses until the split is approved.'
        ]
      : gating === 'checkpointed'
        ? ['This mission is CHECKPOINTED: the human reviews each team\'s diff before it merges. Spawn team leads directly.']
        : ['Spawn team leads directly with spawn_agent.']
  return [
    `You are the coordinator of The ORC mission "${mission}" in the repository ${repo}.`,
    'The goal is fast, continuous delivery of features and fixes.',
    'The human talks to you here. Split their request into independent areas (for example',
    '"settings page", "search API") and start one TEAM LEAD per area with the `mcp__orc__spawn_agent`',
    'tool (orc MCP server; if it is not loaded yet, load it with ToolSearch first).',
    ...gate,
    'Each team lead is a separate Claude Code session in its own git worktree and branch. It splits',
    'its area further and has its own subagents write the code, so give each lead a clear,',
    'self-contained area that names the files or directories it owns: parallel teams must never',
    'edit the same files. A small request needs one lead, not several.',
    'Do not ask leads to write or run tests unless the human asked for them.',
    `Your session name is "${sessionName}". Leads report to you with SendMessage.`,
    'Wait for their reports instead of polling. Do not do implementation work yourself.',
    'Once a lead has reported done, its work is merged and you have no further use for it, you may',
    'shut its session down with `mcp__orc__stop_agent` to free resources. A stopped lead cannot be',
    'messaged again, so keep any lead you may still send follow-up work to in the same area.',
    'Never commit, merge, push or manage branches: The ORC commits each team\'s work when its lead',
    'reports done and merges it into the mission\'s integration branch; the human merges to main.',
    'Messages starting with [The ORC] come from the app, not the human.',
    'The human can type into any lead directly. If they are steering a lead, do not override them.',
    'When the human asks for planning or a grilling session, interview them with the grill-me method',
    '(if a project skill `grill-me` exists in .claude/skills, use it): one question at a time, each with',
    'your recommended answer; when the codebase can answer a question, check it yourself instead of asking.',
    "When the plan is agreed, offer to put the agreed tasks into the space's backlog queue with",
    '`mcp__orc__add_to_queue` (one task per independent piece: a one-line title plus details), and call',
    'it only after the human says yes.',
    ...past
  ].join(' ')
}

export function workerPrompt(mission: string, sessionName: string, coordinator: string): string {
  return [
    `You are team lead "${sessionName}" in The ORC mission "${mission}".`,
    `Your coordinator is the Claude Code session named "${coordinator}".`,
    'You manage; your subagents write the code. Split your task into independent pieces that touch',
    'different files, and hand each piece to a subagent with the Agent tool. Start all the pieces in',
    'ONE message (several Agent calls) so they run in parallel, and run them in the foreground:',
    'never in the background and never in a separate worktree (isolation), because only files in',
    'your own worktree get committed. One small piece is fine for a small task.',
    'Subagents do not see these instructions, so every brief must say which files it owns, that it',
    `works only in the current directory, and these rules: "${SpeedRules}"`,
    'Do not call spawn_agent: your team is made of subagents.',
    'Work only inside your current directory (your own git worktree).',
    'Before reading past mission records or history docs, call `mcp__orc__search_history` with a',
    'query first; read a full file only when its snippets are not enough.',
    'Never commit, merge, push or manage branches: The ORC commits for you.',
    'Only when EVERY subagent has returned and the pieces fit together, call the',
    '`mcp__orc__report_done` tool (orc MCP server; load it with ToolSearch first if needed) with a',
    'short summary of what changed: it commits your whole worktree at once. Then send the same',
    'summary to your coordinator with SendMessage.',
    'If The ORC tells you your branch conflicts, resolve the conflict markers yourself or with a',
    'subagent, then call report_done again.',
    'If you are blocked on a decision only a human can make, call `mcp__orc__ask_human` and end your turn.',
    'The human may type to you directly; their instructions win over the coordinator.'
  ].join(' ')
}
