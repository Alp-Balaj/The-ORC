import type { MissionView } from '../../../shared/types'

/** A mission is ready to integrate (into the ORC branch) when every worker has landed (merged or had nothing to merge),
 *  nothing is waiting on a review/conflict, no agent is still active, and the gate and Verifier
 *  are not mid-run. Nothing merged into main yet, and at least one worker merged. */
export function missionReady(m: MissionView): boolean {
  if (m.mergedToMain || m.merged.length === 0) return false
  if (m.integrated && m.integrated.integrationCommit === m.integrationCommit) return false
  const workers = m.agents.filter((a) => a.role === 'worker')
  if (workers.some((a) => a.merge !== 'merged' && a.merge !== 'nothing')) return false
  if (m.agents.some((a) => a.status === 'starting' || a.status === 'working' || a.status === 'needs-you')) return false
  if (m.gate?.output === 'running…' || m.verifier?.status === 'running') return false
  return true
}

/** Honest summary of the gate and Verifier for the ready band. */
export function readyChecks(m: MissionView): { text: string; allPass: boolean } {
  const gateOk = !!m.gate && m.gate.ok
  const gateFail = !!m.gate && !m.gate.ok
  const v = m.verifier
  const verdict = v && v.status !== 'running' ? (/VERDICT:\s*(\w+)/.exec(v.report)?.[1] ?? null) : null
  const parts: string[] = []
  if (gateOk) parts.push('Gate passed')
  else if (gateFail) parts.push('Gate failed')
  else parts.push('Gate not run')
  if (verdict) parts.push(`Verifier ${verdict.toUpperCase()}`)
  else if (v) parts.push('Verifier has no verdict')
  else parts.push('Verifier not run')
  return { text: parts.join(' · '), allPass: gateOk && verdict === 'PASS' }
}

const key = 'orc.readyBandSeen'
function seen(): string[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as string[]
  } catch {
    return []
  }
}
export function readyBandSeen(id: string): boolean {
  return seen().includes(id)
}
export function markReadyBandSeen(id: string): void {
  if (readyBandSeen(id)) return
  try {
    localStorage.setItem(key, JSON.stringify([...seen(), id].slice(-200)))
  } catch {
    /* storage unavailable: the band just may show again */
  }
}
