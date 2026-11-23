import { useEffect, useState } from 'react'
import type { AutopilotView } from '../../../shared/types'
import { cn } from '../lib/utils'
import { Input } from './ui/input'

const DEFAULT_MAX_TASKS = 5
const DEFAULT_MAX_EMPTY_ROUNDS = 2

function clamp(value: string, fallback: number): number {
  const n = Math.round(Number(value))
  if (value.trim() === '' || !Number.isFinite(n)) return fallback
  return Math.min(10, Math.max(1, n))
}

/** Per-space autopilot switch, limits and status. Applies changes immediately, not through the form's Save. */
export function AutopilotToggle({ root }: { root: string }): React.JSX.Element {
  const [entry, setEntry] = useState<AutopilotView | null>(null)
  const [maxTasks, setMaxTasks] = useState(String(DEFAULT_MAX_TASKS))
  const [maxEmptyRounds, setMaxEmptyRounds] = useState(String(DEFAULT_MAX_EMPTY_ROUNDS))

  useEffect(() => {
    const pick = (all: AutopilotView[]): void => setEntry(all.find((a) => a.root === root) ?? null)
    void window.orc.listAutopilot().then(pick)
    return window.orc.onAutopilot(pick)
  }, [root])

  // Keep the number drafts in step with the stored values whenever they change from outside.
  const storedMax = entry?.maxTasks ?? DEFAULT_MAX_TASKS
  const storedEmpty = entry?.maxEmptyRounds ?? DEFAULT_MAX_EMPTY_ROUNDS
  useEffect(() => {
    setMaxTasks(String(storedMax))
    setMaxEmptyRounds(String(storedEmpty))
  }, [storedMax, storedEmpty])

  const enabled = entry?.enabled ?? false
  const status = entry?.status ?? ''
  const alert = entry?.state === 'usage' || entry?.state === 'stopped'

  // Enter in a number field would submit the parent form; blur (which applies the value) instead.
  const commitOnEnter = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.currentTarget.blur()
    }
  }

  const apply = (patch: { enabled?: boolean; maxTasks?: number; maxEmptyRounds?: number }): void => {
    void window.orc.autopilotSet(root, patch)
  }

  return (
    <div className="space-y-1.5" data-testid="autopilot">
      <label className="flex items-center gap-2 text-[11px] leading-snug text-muted-foreground">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => apply({ enabled: e.target.checked })}
          className="accent-primary"
          data-testid="autopilot-enabled"
        />
        Autopilot: when the queue runs empty, find new tasks
      </label>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="block text-[11px] leading-snug text-muted-foreground">Max tasks per round (1-10)</label>
          <Input
            type="number"
            min={1}
            max={10}
            value={maxTasks}
            onChange={(e) => setMaxTasks(e.target.value)}
            onBlur={() => {
              const next = clamp(maxTasks, DEFAULT_MAX_TASKS)
              setMaxTasks(String(next))
              apply({ maxTasks: next })
            }}
            onKeyDown={commitOnEnter}
            data-testid="autopilot-max-tasks"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-[11px] leading-snug text-muted-foreground">Stop after N empty rounds (1-10)</label>
          <Input
            type="number"
            min={1}
            max={10}
            value={maxEmptyRounds}
            onChange={(e) => setMaxEmptyRounds(e.target.value)}
            onBlur={() => {
              const next = clamp(maxEmptyRounds, DEFAULT_MAX_EMPTY_ROUNDS)
              setMaxEmptyRounds(String(next))
              apply({ maxEmptyRounds: next })
            }}
            onKeyDown={commitOnEnter}
            data-testid="autopilot-max-empty-rounds"
          />
        </div>
      </div>
      {status && (
        <p className={cn('text-[11px] leading-snug text-muted-foreground', alert && 'text-needs')} data-testid="autopilot-status">
          {status}
        </p>
      )}
    </div>
  )
}
