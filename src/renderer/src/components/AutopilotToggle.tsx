import { useEffect, useState } from 'react'
import type { AutopilotView } from '../../../shared/types'
import { cn } from '../lib/utils'
import { Input } from './ui/input'
import { openLoopSetup } from './LoopSetupDialog'

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
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3" data-testid="autopilot">
      <label className="flex items-center gap-2 text-[12px] font-medium leading-snug text-foreground">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => apply({ enabled: e.target.checked })}
          className="shrink-0 accent-primary"
          data-testid="autopilot-enabled"
        />
        Autopilot: find new tasks when the queue runs empty
      </label>
      <p className="text-[11.5px] leading-snug text-muted-foreground">Switches on or off right away; you don't need to press Save.</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="autopilot-max-tasks" className="text-[12px] font-medium text-foreground">New tasks per round</label>
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
            id="autopilot-max-tasks"
            aria-describedby="autopilot-limits-help"
            data-testid="autopilot-max-tasks"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="autopilot-max-empty-rounds" className="text-[12px] font-medium text-foreground">Stop after empty rounds</label>
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
            id="autopilot-max-empty-rounds"
            aria-describedby="autopilot-limits-help"
            data-testid="autopilot-max-empty-rounds"
          />
        </div>
      </div>
      <p id="autopilot-limits-help" className="text-[11.5px] leading-snug text-muted-foreground">Each round adds up to the first number of tasks (1 to 10). Autopilot stops after the second number of rounds in a row find nothing (1 to 10).</p>
      <button type="button" className="cursor-pointer text-[11.5px] text-muted-foreground underline hover:text-foreground" onClick={() => openLoopSetup(root)} data-testid="autopilot-setup">Guided loop setup…</button>
      {status && (
        <p className={cn('text-[11.5px] leading-snug text-muted-foreground', alert && 'text-needs')} data-testid="autopilot-status">
          {status}
        </p>
      )}
    </div>
  )
}
