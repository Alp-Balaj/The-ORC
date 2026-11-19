import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ControlServer, type HookEvent } from '../src/main/control-server.ts'

const calls: string[] = []
const server = new ControlServer({
  agentForToken: (t) => (t === 'good' ? 'agent-1' : null),
  spawnAgent: async (caller, name, task) => { calls.push(`spawn ${caller} ${name} ${task}`); return `started ${name}` },
  reportDone: (caller, s) => { calls.push(`done ${caller} ${s}`) },
  askHuman: (caller, q) => { calls.push(`ask ${caller} ${q}`) },
  stopAgent: (caller, n) => { calls.push(`stop ${caller} ${n}`); return 'stopped' },
  proposeSplit: (caller, s, w) => { calls.push(`split ${caller} ${s} ${w.length}`); return 'pending' },
  hookEvent: (caller, e: HookEvent) => { calls.push(`hook ${caller} ${e.hook_event_name}`); return e.hook_event_name === 'PreToolUse' ? '{"hookSpecificOutput":{}}' : null }
})
const port = await server.listen()
const base = `http://127.0.0.1:${port}`
const fail = (m: string): never => { console.error('FAIL', m); process.exit(1) }

const client = new Client({ name: 'smoke', version: '0' })
await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
  requestInit: { headers: { Authorization: 'Bearer good' } }
}))
const tools = (await client.listTools()).tools.map((t) => t.name).sort()
if (tools.join() !== 'ask_human,propose_split,report_done,spawn_agent,stop_agent') fail(`tools ${tools}`)
const sp = await client.callTool({ name: 'propose_split', arguments: { summary: 'two files', workers: [{ name: 'a', task: 'x' }, { name: 'b', task: 'y' }] } })
if (!JSON.stringify(sp).includes('pending')) fail('propose_split result')
const r = await client.callTool({ name: 'spawn_agent', arguments: { name: 'post-api', task: 'build it' } })
if (!JSON.stringify(r).includes('started post-api')) fail('spawn result')
const bad = await client.callTool({ name: 'spawn_agent', arguments: { name: 'Bad Name!', task: 'x' } })
if (!bad.isError) fail('invalid name accepted')
const st = await client.callTool({ name: 'stop_agent', arguments: { name: 'post-api' } })
if (!JSON.stringify(st).includes('stopped')) fail('stop_agent result')
await client.close()

const hook = await fetch(`${base}/hook`, { method: 'POST', headers: { Authorization: 'Bearer good' }, body: JSON.stringify({ hook_event_name: 'Stop' }) })
if (hook.status !== 204) fail(`hook ${hook.status}`)
const reply = await fetch(`${base}/hook`, { method: 'POST', headers: { Authorization: 'Bearer good' }, body: JSON.stringify({ hook_event_name: 'PreToolUse' }) })
if (reply.status !== 200 || !(await reply.text()).includes('hookSpecificOutput')) fail(`hook reply ${reply.status}`)
const noTok = await fetch(`${base}/hook`, { method: 'POST', body: '{}' })
if (noTok.status !== 401) fail(`no token ${noTok.status}`)
const browser = await fetch(`${base}/hook`, { method: 'POST', headers: { Authorization: 'Bearer good', Origin: 'https://evil.example' }, body: '{}' })
if (browser.status !== 403) fail(`origin ${browser.status}`)

const want = ['spawn agent-1 post-api build it', 'hook agent-1 Stop', 'split agent-1 two files 2', 'stop agent-1 post-api']
for (const w of want) if (!calls.includes(w)) fail(`missing call ${w}: ${calls}`)
server.close()
console.log('PASS', tools.join(','), '|', calls.join(' | '))
