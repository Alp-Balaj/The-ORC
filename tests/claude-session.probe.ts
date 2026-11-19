// Billed probe (a few cents on Haiku): does a real `claude` accept The ORC's flags,
// reach its MCP tools with the per-agent token, and fire its hooks?
// Run by hand: node --no-warnings tests/claude-session.probe.ts <repo-dir>
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { claudeArgs } from '../src/main/claude-launch.ts'
import { ControlServer } from '../src/main/control-server.ts'

const cwd = process.argv[2]
if (!cwd) throw new Error('usage: claude-session.probe.ts <repo-dir>')
const events: string[] = []
const calls: string[] = []
const server = new ControlServer({
  agentForToken: (t) => (t === 'probe-token' ? 'probe' : null),
  spawnAgent: async () => 'not in probe',
  reportDone: (_c, s) => { calls.push(`report_done: ${s}`) },
  askHuman: () => {},
  stopAgent: () => 'stopped',
  proposeSplit: () => 'pending',
  hookEvent: (_c, e) => { events.push(e.hook_event_name + (e.tool_name ? `(${e.tool_name})` : '')); return null }
})
const port = await server.listen()
const args = claudeArgs({
  sessionName: 'orc-probe/worker',
  sessionId: randomUUID(),
  token: 'probe-token',
  controlPort: port,
  permissionMode: 'acceptEdits',
  systemPrompt: 'You are a probe for The ORC. Do exactly what the user asks and nothing else.',
  firstPrompt: 'Call the report_done tool from the orc MCP server with summary "probe ok". Then reply DONE.'
})
const child = spawn('claude', ['-p', ...args, '--model', 'haiku'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
let out = ''
child.stdout.on('data', (d) => (out += d))
child.stderr.on('data', (d) => (out += d))
const code = await new Promise<number>((r) => child.on('close', (c) => r(c ?? -1)))
server.close()
console.log('exit', code, '| output:', out.trim().slice(-200))
console.log('tool calls:', calls)
console.log('hooks:', events.join(' → '))
process.exit(calls.length === 1 && events.includes('Stop') ? 0 : 1)
