import type { MissionView } from '../../../shared/types'
import { missionAttention } from './attention'

export type MissionSort = 'newest' | 'oldest' | 'name' | 'attention'

export const MISSION_SORTS: { id: MissionSort; label: string }[] = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'name', label: 'Name A–Z' },
  { id: 'attention', label: 'Needs attention first' }
]

const KEY = 'orc-mission-sort'

export function getMissionSort(): MissionSort {
  try {
    const v = localStorage.getItem(KEY)
    if (MISSION_SORTS.some((s) => s.id === v)) return v as MissionSort
  } catch {
    // storage unavailable
  }
  return 'newest'
}

export function saveMissionSort(s: MissionSort): void {
  try {
    localStorage.setItem(KEY, s)
  } catch {
    // storage unavailable
  }
}

/** 0 = agents waiting on you (or failing), 1 = running, 2 = stopped. */
function rank(m: MissionView): number {
  const t = missionAttention(m).tier
  if (t === 'error' || t === 'needs') return 0
  return m.state === 'running' ? 1 : 2
}

/** A sorted copy; ties fall back to newest first. */
export function sortMissions(ms: MissionView[], sort: MissionSort): MissionView[] {
  const newest = (a: MissionView, b: MissionView): number => b.createdAt - a.createdAt
  const cmp: Record<MissionSort, (a: MissionView, b: MissionView) => number> = {
    newest,
    oldest: (a, b) => a.createdAt - b.createdAt,
    name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) || newest(a, b),
    attention: (a, b) => rank(a) - rank(b) || newest(a, b)
  }
  return [...ms].sort(cmp[sort])
}
