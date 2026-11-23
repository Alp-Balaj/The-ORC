import { execFile } from 'node:child_process'
import { sessionEnv } from './claude-launch.ts'

/** Reads `claude agents --json` (≈0.2 s) and returns session id → "busy" | "idle" | …,
 *  for interactive sessions ("status") and background ones ("state"). */
export function readAgentStates(): Promise<Map<string, string>> {
  return new Promise((resolve) => {
    execFile('claude', ['agents', '--json'], { timeout: 10_000, env: sessionEnv() }, (err, stdout) => {
      const states = new Map<string, string>()
      if (!err) {
        let parsed: { sessionId?: string; status?: string; state?: string }[] = []
        try {
          parsed = JSON.parse(stdout)
        } catch (e) {
          // Malformed or partial CLI output is safe to ignore: it yields an empty states map and
          // the poller simply retries on its next tick. Anything but a parse error is a real bug.
          if (!(e instanceof SyntaxError)) throw e
        }
        for (const a of parsed) {
          if (a.sessionId) states.set(a.sessionId, a.status ?? a.state ?? 'unknown')
        }
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
