import { shownAgents, type AgentView, type MissionView } from '../../../shared/types'

/** The one priority ladder for every marker, dot and pill, highest first:
 *  error (red) > needs you (amber) > ready (accent) > working (green) > done (muted). */
export type Tier = 'error' | 'needs' | 'ready' | 'working' | 'done'
export const tierOrder: Tier[] = ['error', 'needs', 'ready', 'working', 'done']

/** Dot / pill colours per tier. */
export const tierBg: Record<Tier, string> = {
  error: 'bg-destructive',
  needs: 'bg-needs',
  ready: 'bg-primary',
  working: 'bg-working',
  done: 'bg-done'
}
export const tierGlow: Partial<Record<Tier, string>> = {
  error: 'shadow-[0_0_0_3px] shadow-destructive/25',
  needs: 'shadow-[0_0_0_3px] shadow-needs/20'
}

/** Red: a merge conflict. Crashed sessions (crash-vs-clean-exit work) belong here too. */
export const isError = (a: AgentView): boolean => a.merge === 'conflict' || (a as { crashed?: boolean }).crashed === true

export function agentTier(a: AgentView): Tier | null {
  if (isError(a)) return 'error'
  if (a.status === 'needs-you') return 'needs'
  if (a.merge === 'review') return 'ready'
  if (a.status === 'working' || a.status === 'starting') return 'working'
  if (a.status === 'done' || a.status === 'exited') return 'done'
  return null
}

export interface MissionAttention {
  tier: Tier | null
  /** Agents in error / needing you (a pending plan-check split counts as one needs-you). */
  errors: number
  needs: number
  ready: number
  /** The first waiting question, or the pending split's summary, to show on hover. */
  question: string | null
  title: string
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

export function missionAttention(m: MissionView): MissionAttention {
  const agents = shownAgents(m)
  const tiers = agents.map(agentTier)
  const errors = tiers.filter((t) => t === 'error').length
  const splitPending = m.split?.status === 'pending'
  const needs = tiers.filter((t) => t === 'needs').length + (splitPending ? 1 : 0)
  const ready = tiers.filter((t) => t === 'ready').length
  const asking = agents.find((a, i) => tiers[i] === 'needs' && a.question)
  const question = asking ? `${asking.name}: ${asking.question}` : splitPending ? `Plan check: approve the proposed split (${m.split!.workers.length} workers)` : null
  const tier = errors > 0 ? 'error' : needs > 0 ? 'needs' : ready > 0 ? 'ready' : tiers.includes('working') ? 'working' : tiers.length > 0 ? 'done' : null
  const parts = [
    errors > 0 && plural(errors, 'agent in error (conflict or crash)', 'agents in error (conflict or crash)'),
    needs > 0 && `${needs} need${needs === 1 ? 's' : ''} you`,
    ready > 0 && `${ready} ready to review`
  ].filter(Boolean)
  return { tier, errors, needs, ready, question, title: [parts.join(' · '), question].filter(Boolean).join('\n') }
}

/** The highest tier across several missions (space rows). */
export function topTier(ts: (Tier | null)[]): Tier | null {
  return tierOrder.find((t) => ts.includes(t)) ?? null
}
