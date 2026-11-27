import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'

export interface HookEvent {
  hook_event_name: string
  session_id?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  message?: string
  prompt?: string
  tool_response?: unknown
  transcript_path?: string
  notification_type?: string
  [key: string]: unknown
}

/** What the control server needs from the mission layer. The token identifies
 *  the calling agent, so a request can only ever act as that agent. */
export interface ControlHandlers {
  agentForToken(token: string): string | null
  spawnAgent(caller: string, name: string, task: string): Promise<string>
  reportDone(caller: string, summary: string): void
  askHuman(caller: string, question: string): void
  /** Ends a finished worker's session. Returns the reply for the caller. */
  stopAgent(caller: string, name: string, reason: string | null): string
  proposeSplit(caller: string, summary: string, workers: { name: string; task: string }[]): string
  /** Coordinator only: integrate the caller's mission into the repo's ORC branch. */
  integrateMission(caller: string): Promise<string>
  /** Returns the hook's stdout (JSON for Claude Code), or null for none. */
  hookEvent(caller: string, event: HookEvent): string | null
}

/** The server's full handler set: the mission layer's, plus what index.ts answers itself. */
export interface ServerHandlers extends ControlHandlers {
  /** Full-text search over the caller's mission records and its repo's docs/. */
  searchHistory(caller: string, query: string, limit: number | null): string
  /** Coordinator only: appends tasks to the caller's space backlog queue. */
  addToQueue(caller: string, tasks: { title: string; details?: string }[]): Promise<string> | string
  /** Main session only: a read-only overview of every mission and space. */
  listMissions(caller: string): string
  /** Main session only: starts a mission in a space with the main session's permission mode. */
  startMission(caller: string, repoPath: string, name: string, brief: string): Promise<string>
}

const MaxBody = 1024 * 1024

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MaxBody) {
        reject(new Error('body too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function bearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization
  return h?.startsWith('Bearer ') ? h.slice(7) : null
}

function text(t: string): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: t }] }
}

function buildMcp(caller: string, h: ServerHandlers): McpServer {
  const server = new McpServer({ name: 'orc', version: '0.0.1' })
  server.registerTool(
    'spawn_agent',
    {
      description:
        'Start a team lead (new Claude Code session, own worktree/branch) with `task` as its first prompt. Returns its session name.',
      inputSchema: {
        name: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]{0,39}$/)
          .describe('Kebab-case, unique in mission'),
        task: z.string().min(1).describe('Self-contained task incl. files it owns')
      }
    },
    async ({ name, task }) => text(await h.spawnAgent(caller, name, task))
  )
  server.registerTool(
    'report_done',
    {
      description: 'Task finished; The ORC commits your worktree.',
      inputSchema: { summary: z.string().min(1).describe('What changed, few lines') }
    },
    async ({ summary }) => {
      h.reportDone(caller, summary)
      return text('Recorded. Now send the same summary to your coordinator with SendMessage.')
    }
  )
  server.registerTool(
    'ask_human',
    {
      description: 'Ask the human something you cannot resolve. End your turn after.',
      inputSchema: { question: z.string().min(1) }
    },
    async ({ question }) => {
      h.askHuman(caller, question)
      return text('Shown to the human. Their answer will be typed into this session. End your turn now.')
    }
  )
  server.registerTool(
    'stop_agent',
    {
      description:
        'End a finished worker\'s session (after report_done and merge). Worktree/branch kept; it cannot be messaged again. Refused while its work is committing, in review or in conflict.',
      inputSchema: {
        name: z.string().min(1).describe('Worker name'),
        reason: z.string().optional().describe('Why (shown in feed)')
      }
    },
    async ({ name, reason }) => text(h.stopAgent(caller, name, reason ?? null))
  )
  server.registerTool(
    'propose_split',
    {
      description:
        'Coordinator only, plan-check missions: propose the split before spawning. Returns "pending"; human decision arrives as a [The ORC] message. End your turn.',
      inputSchema: {
        summary: z.string().min(1).describe('The approach, one line'),
        workers: z
          .array(z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/), task: z.string().min(1) }))
          .min(1)
          .max(12)
          .describe('Intended workers + owned files')
      }
    },
    async ({ summary, workers }) => text(h.proposeSplit(caller, summary, workers))
  )
  server.registerTool(
    'integrate_mission',
    {
      description:
        'Coordinator only: when every lead has reported and merged, integrate the mission into the repo\'s ORC branch (not main). Returns the result, or "pending" on conflict (a [The ORC] message follows).',
      inputSchema: {}
    },
    async () => text(await h.integrateMission(caller))
  )
  server.registerTool(
    'search_history',
    {
      description:
        'BM25 search of past ORC mission records and the repo\'s docs/ (PLAN, HANDOFF, ADRs). Returns short ranked snippets. ' +
        'Use BEFORE reading records/docs in full; read a file only if a snippet is not enough. Code is not indexed.',
      inputSchema: {
        query: z.string().min(1).describe('Keywords'),
        limit: z.number().int().min(1).max(25).optional().describe('Max snippets')
      }
    },
    async ({ query, limit }) => text(h.searchHistory(caller, query, limit ?? null))
  )
  server.registerTool(
    'add_to_queue',
    {
      description:
        "Coordinator only. Append tasks to the space's backlog queue; each becomes a mission run after this one.",
      inputSchema: {
        tasks: z
          .array(
            z.object({
              title: z.string().trim().min(1).max(200).describe('The task'),
              details: z.string().optional().describe('Brief')
            })
          )
          .min(1)
          .max(20)
      }
    },
    async ({ tasks }) => text(await h.addToQueue(caller, tasks))
  )
  server.registerTool(
    'list_missions',
    {
      description:
        'Main session only. Read-only overview of all missions and spaces (state, leads, branches, merge status).',
      inputSchema: {}
    },
    async () => text(h.listMissions(caller))
  )
  server.registerTool(
    'start_mission',
    {
      description:
        'Main session only, only when the human asked: start a mission in a space (repoPath = space root from list_missions).',
      inputSchema: {
        repoPath: z.string().min(1).describe('Space root'),
        name: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]{0,39}$/)
          .describe('Kebab-case, unique across spaces'),
        brief: z.string().min(1).describe('Self-contained brief')
      }
    },
    async ({ repoPath, name, brief }) => text(await h.startMission(caller, repoPath, name, brief))
  )
  return server
}

export class ControlServer {
  private server: Server | null = null
  private readonly handlers: ServerHandlers

  constructor(handlers: ServerHandlers) {
    this.handlers = handlers
  }

  async listen(): Promise<number> {
    this.server = createServer((req, res) => void this.route(req, res))
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve))
    return (this.server.address() as AddressInfo).port
  }

  close(): void {
    this.server?.close()
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      // Browsers attach Origin; Claude Code and curl don't. Refusing any Origin keeps web pages out.
      if (req.headers.origin) return end(res, 403, 'forbidden')
      const token = bearer(req)
      const caller = token ? this.handlers.agentForToken(token) : null
      if (!caller) return end(res, 401, 'unauthorized')

      const url = req.url ?? ''
      if (url === '/hook' && req.method === 'POST') {
        const event = JSON.parse(await readBody(req)) as HookEvent
        const out = this.handlers.hookEvent(caller, event)
        if (!out) return end(res, 204, '')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(out)
        return
      }
      if (url === '/mcp') {
        if (req.method !== 'POST') return end(res, 405, 'method not allowed')
        const body = JSON.parse(await readBody(req))
        const mcp = buildMcp(caller, this.handlers)
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true
        })
        res.on('close', () => {
          void transport.close()
          void mcp.close()
        })
        await mcp.connect(transport)
        await transport.handleRequest(req, res, body)
        return
      }
      end(res, 404, 'not found')
    } catch (err) {
      if (!res.headersSent) end(res, 400, String(err))
    }
  }
}

function end(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain' })
  res.end(body)
}
