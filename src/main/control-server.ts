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
  [key: string]: unknown
}

/** What the control server needs from the mission layer. The token identifies
 *  the calling agent, so a request can only ever act as that agent. */
export interface ControlHandlers {
  agentForToken(token: string): string | null
  spawnAgent(caller: string, name: string, task: string): Promise<string>
  reportDone(caller: string, summary: string): void
  askHuman(caller: string, question: string): void
  hookEvent(caller: string, event: HookEvent): void
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

function buildMcp(caller: string, h: ControlHandlers): McpServer {
  const server = new McpServer({ name: 'orc', version: '0.0.1' })
  server.registerTool(
    'spawn_agent',
    {
      description:
        'Start a worker agent: a new Claude Code session in its own git worktree and branch, ' +
        'given `task` as its first prompt. Returns the worker session name to message it by.',
      inputSchema: {
        name: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]{0,39}$/)
          .describe('Short kebab-case worker name, unique in this mission, e.g. "post-api"'),
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
  return server
}

export class ControlServer {
  private server: Server | null = null
  private readonly handlers: ControlHandlers

  constructor(handlers: ControlHandlers) {
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
        this.handlers.hookEvent(caller, event)
        return end(res, 204, '')
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
