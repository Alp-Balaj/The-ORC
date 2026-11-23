import { useEffect, useState } from 'react'
import type { AutopilotView } from '../../../shared/types'
import { cn } from '../lib/utils'

type State = AutopilotView['state']

const dot: Record<State, string> = {
  off: 'bg-faint',
  idle: 'bg-done',
  discovering: 'bg-working animate-orc-pulse',
  waiting: 'bg-done',
  usage: 'bg-needs',
  stopped: 'bg-needs'
}
const label: Record<State, string> = { off: 'off', idle: 'idle', discovering: 'discovering', waiting: 'waiting', usage: 'usage', stopped: 'stopped' }

const errText = (err: unknown): string => String(err).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '')

/** One-click per-space autopilot switch with a state dot. Limits stay in the loop setup dialog / space settings. */
export function AutopilotSwitch({ root, showLabel = false }: { root: string | null; showLabel?: boolean }): React.JSX.Element {
  const [entry, setEntry] = useState<AutopilotView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    if (!root) {
      setEntry(null)
      return
    }
    const pick = (all: AutopilotView[]): void => setEntry(all.find((a) => a.root === root) ?? null)
    void window.orc.listAutopilot().then(pick).catch((e) => setError(errText(e)))
    return window.orc.onAutopilot(pick)
  }, [root])

  const enabled = entry?.enabled ?? false
  const state: State = entry?.state ?? 'off'
  const disabled = !root || busy
  const tip = !root
    ? 'Select a space to use autopilot'
    : error
      ? `Autopilot error: ${error}`
      : `Autopilot ${enabled ? 'on' : 'off'} (${label[state]})${entry?.status ? `: ${entry.status}` : ''}. Click to turn ${enabled ? 'off' : 'on'}.`

  const toggle = (): void => {
    if (!root) return
    setBusy(true)
    setError(null)
    window.orc
      .autopilotSet(root, { enabled: !enabled })
      .catch((e) => setError(errText(e)))
      .finally(() => setBusy(false))
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="Autopilot"
      disabled={disabled}
      onClick={toggle}
      title={tip}
      className={cn('flex shrink-0 cursor-pointer items-center gap-1 rounded-full px-1 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default disabled:opacity-40', error && 'text-destructive')}
      data-testid="autopilot-switch"
      data-state={state}
    >
      <span className={cn('size-1.5 rounded-full', error ? 'bg-destructive' : dot[state])} />
      <span className={cn('relative h-3 w-5.5 rounded-full border transition-colors', enabled ? 'border-primary bg-primary' : 'border-border-strong bg-secondary')}>
        <span className={cn('absolute top-px size-2 rounded-full bg-white transition-all', enabled ? 'left-[calc(100%-0.6rem)]' : 'left-px opacity-70')} />
      </span>
      {showLabel && <span className={cn((state === 'usage' || state === 'stopped') && 'text-needs')}>{error ? 'error' : label[state]}</span>}
    </button>
  )
}
