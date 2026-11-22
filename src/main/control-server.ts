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
  /** Returns the hook's stdout (JSON for Claude Code), or null for none. */
  hookEvent(caller: string, event: HookEvent): string | null
}

/** The server's full handler set: the mission layer's, plus what index.ts answers itself. */
export interface ServerHandlers extends ControlHandlers {
  /** Full-text search over the caller's mission records and its repo's docs/. */
  searchHistory(caller: string, query: string, limit: number | null): string
  /** Coordinator only: appends tasks to the caller's space backlog queue. */
  addToQueue(caller: string, tasks: { title: string; details?: string }[]): Promise<string> | string
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
        'Start a team lead: a new Claude Code session in its own git worktree and branch, ' +
        'given `task` as its first prompt. It splits the task among its own subagents. ' +
        'Returns the lead session name to message it by.',
      inputSchema: {
        name: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]{0,39}$/)
          .describe('Short kebab-case name, unique in this mission, e.g. "post-api"'),
        task: z.string().min(1).describe('Self-contained task, including the files/areas it owns')
      }
    },
    async ({ name, task }) => text(await h.spawnAgent(caller, name, task))
  )
  server.registerTool(
    'report_done',
    {
      description: 'Tell The ORC your task is finished. The ORC will commit your worktree.',
      inputSchema: { summary: z.string().min(1).describe('What you changed, in a few lines') }
    },
    async ({ summary }) => {
      h.reportDone(caller, summary)
      return text('Recorded. Now send the same summary to your coordinator with SendMessage.')
    }
  )
  server.registerTool(
    'ask_human',
    {
      description: 'Ask the human a question you cannot resolve yourself. End your turn after.',
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
        'Shut down a worker you started, once its job is finished: it has called report_done and ' +
        'The ORC has merged its work (or found nothing to merge). Ends its Claude Code session; its ' +
        'worktree and branch are kept. A stopped worker cannot be messaged again. Refused (with the ' +
        'reason) while its work is still being committed, reviewed or in conflict.',
      inputSchema: {
        name: z.string().min(1).describe('The worker\'s name, e.g. "post-api" (or its session name "<mission>/post-api")'),
        reason: z.string().optional().describe('Optional: why, shown in the mission feed')
      }
    },
    async ({ name, reason }) => text(h.stopAgent(caller, name, reason ?? null))
  )
  server.registerTool(
    'propose_split',
    {
      description:
        'Coordinator only, plan-check missions: propose how to split the work before spawning. ' +
        'Returns "pending" at once; the human approves or rejects in The ORC and you get a [The ORC] message. End your turn after calling it.',
      inputSchema: {
        summary: z.string().min(1).describe('One line: the approach'),
        workers: z
          .array(z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/), task: z.string().min(1) }))
          .min(1)
          .max(12)
          .describe('The workers you intend to spawn, each with the files/areas it owns')
      }
    },
    async ({ summary, workers }) => text(h.proposeSplit(caller, summary, workers))
  )
  server.registerTool(
    'search_history',
    {
      description:
        'Search what has already happened in this repo: past ORC mission records (briefs, team reports, ' +
        'Verifier reports, merges) and the repo\'s docs/ (PLAN, HANDOFF, ADRs, decisions). Local full-text ' +
        '(BM25) search; returns short ranked snippets with source file, section heading, mission and date. ' +
        'Use it BEFORE reading past mission records or docs in full: a search costs a few hundred tokens, ' +
        'reading the records costs tens of thousands. Read a file only when a snippet is not enough. ' +
        'Code is not indexed: use CodeGraph/grep for code.',
      inputSchema: {
        query: z.string().min(1).describe('Keywords, e.g. "stop_agent merge conflict"'),
        limit: z.number().int().min(1).max(25).optional().describe('Max snippets (default set by The ORC)')
      }
    },
    async ({ query, limit }) => text(h.searchHistory(caller, query, limit ?? null))
  )
  server.registerTool(
    'add_to_queue',
    {
      description:
        "Coordinator only. Append tasks to this space's backlog queue in The ORC; each becomes its own " +
        'mission, run back to back after this one.',
      inputSchema: {
        tasks: z
          .array(
            z.object({
              title: z.string().trim().min(1).max(200).describe('One line: the task'),
              details: z.string().optional().describe('Optional: the brief for its mission')
            })
          )
          .min(1)
          .max(20)
      }
    },
    async ({ tasks }) => text(await h.addToQueue(caller, tasks))
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
