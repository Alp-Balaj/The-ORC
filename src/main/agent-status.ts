import { execFile } from 'node:child_process'
import { sessionEnv } from './claude-launch.ts'

/** Reads `claude agents --json` (≈0.2 s) and returns session id → "busy" | "idle" | …,
 *  for interactive sessions ("status") and background ones ("state"). */
export function readAgentStates(): Promise<Map<string, string>> {
  return new Promise((resolve) => {
    execFile('claude', ['agents', '--json'], { timeout: 10_000, env: sessionEnv() }, (err, stdout) => {
      const states = new Map<string, string>()
      if (!err) {
        try {
          for (const a of JSON.parse(stdout) as { sessionId?: string; status?: string; state?: string }[]) {
            if (a.sessionId) states.set(a.sessionId, a.status ?? a.state ?? 'unknown')
          }
        } catch {}
      }
      resolve(states)
    })
  })
}

/** Polls while any agent is mid-turn or at a prompt; does nothing otherwise. */
export function startStatusPoller(
  live: () => string[],
  apply: (states: Map<string, string>) => void,
  everyMs = 4000
): () => void {
  let busy = false
  const timer = setInterval(() => {
    if (busy || live().length === 0) return
    busy = true
    void readAgentStates()
      .then(apply)
      .finally(() => (busy = false))
  }, everyMs)
  timer.unref()
  return () => clearInterval(timer)
}
