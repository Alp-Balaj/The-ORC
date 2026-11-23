import { useEffect, useRef, useState } from 'react'
import { Settings2, X } from 'lucide-react'
import type { SpaceView } from '../../../shared/types'
import { AutopilotToggle } from './AutopilotToggle'
import { fromDraft, ModelFields, toDraft } from './ModelFields'
import { Button } from './ui/button'
import { Field, FormSection as Section } from './ui/field'
import { Input } from './ui/input'

/** Window event that opens the space settings: `detail` is the space root. */
export const SPACE_SETTINGS_EVENT = 'orc:space-settings'
export const openSpaceSettings = (root: string): void => void window.dispatchEvent(new CustomEvent(SPACE_SETTINGS_EVENT, { detail: root }))

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'

/** Null when `value` is a whole number in [min, max]; otherwise the message to show. */
function wholeError(value: string, min: number, max: number): string | null {
  const n = Number(value)
  return value.trim() !== '' && Number.isInteger(n) && n >= min && n <= max ? null : `Enter a whole number from ${min} to ${max}.`
}

/** Per-space settings. Saves with one updateSpace call; stays open with the error if the save fails. */
export function SpaceSettingsModal({ space, onClose, onRerunOnboarding }: { space: SpaceView; onClose: () => void; onRerunOnboarding: () => void }): React.JSX.Element {
  const [gate, setGate] = useState(space.gateCommand ?? '')
  const [run, setRun] = useState(space.runCommand ?? '')
  const [records, setRecords] = useState(space.recordsDir ?? '')
  const [max, setMax] = useState(String(space.maxLive))
  const [parallel, setParallel] = useState(String(space.maxParallel))
  const [threshold, setThreshold] = useState(String(space.usageThreshold))
  const [idleStop, setIdleStop] = useState(String(space.idleStopMinutes))
  const [models, setModels] = useState(toDraft(space.models))
  const [notify, setNotify] = useState(space.notifications)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [disconnectError, setDisconnectError] = useState<string | null>(null)
  const name = space.root.split(/[\\/]/).filter(Boolean).pop() ?? space.root
  const dialog = useRef<HTMLDivElement>(null)
  // Read during the first render, before the autofocused field takes focus, so Escape can give it back.
  const [returnFocus] = useState(() => document.activeElement)
  const suggested = space.suggestedGate
  const errors = {
    max: wholeError(max, 1, 50),
    parallel: wholeError(parallel, 1, 10),
    threshold: wholeError(threshold, 1, 100),
    idleStop: wholeError(idleStop, 0, 1440)
  }
  const valid = Object.values(errors).every((e) => e === null)

  useEffect(() => {
    return () => {
      if (returnFocus instanceof HTMLElement) returnFocus.focus()
    }
  }, [returnFocus])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation() // keeps App's Escape-leaves-screen handler from also firing
        if (!saving) onClose()
        return
      }
      if (e.key !== 'Tab' || !dialog.current) return
      const items = Array.from(dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      const inside = active instanceof Node && dialog.current.contains(active)
      if (e.shiftKey && (!inside || active === first)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, saving])

  async function disconnect(): Promise<void> {
    setDisconnecting(true)
    setDisconnectError(null)
    try {
      await window.orc.removeSpace(space.root)
      onClose()
    } catch (err) {
      setDisconnectError(String(err).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, ''))
      setDisconnecting(false)
    }
  }

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!valid || saving) return
    setSaving(true)
    setError(null)
    try {
      await window.orc.updateSpace(space.root, {
        gateCommand: gate || null,
        maxLive: Number(max),
        recordsDir: records || null,
        runCommand: run || null,
        models: fromDraft(models),
        usageThreshold: Number(threshold),
        maxParallel: Number(parallel),
        notifications: notify,
        idleStopMinutes: Number(idleStop)
      })
      onClose()
    } catch (err) {
      setError(String(err).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, ''))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="space-settings-title"
        data-testid="space-settings-dialog"
        className="flex max-h-[85vh] w-full max-w-[560px] flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-2xl"
      >
        <form data-testid="space-settings" onSubmit={save} className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2">
            <div className="flex items-start gap-2.5">
              <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Settings2 className="size-3.5" /></div>
              <div>
                <h2 id="space-settings-title" className="text-[14px] font-semibold">Space settings</h2>
                <p className="text-[11.5px] leading-snug text-muted-foreground" title={space.root}>{space.root.split(/[\\/]/).filter(Boolean).pop()}</p>
              </div>
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={onClose} disabled={saving} title="Close (Esc)" aria-label="Close"><X /></Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2">
            <fieldset disabled={saving} className="min-w-0 space-y-6 border-0 p-0 text-[12px]">
              <Section title="Commands" description="Shell commands The ORC runs in this repo. Both are optional.">
                <Field id="ss-run" label="Run command" optional hint="What the Run app button runs, inside a mission's integration branch.">
                  <Input id="ss-run" autoFocus value={run} onChange={(e) => setRun(e.target.value)} placeholder="e.g. pnpm install && pnpm dev" data-testid="run-command" />
                </Field>
                <Field id="ss-gate" label="Gate command" optional hint="A check (such as your tests) that must pass on each merged result. Leave empty to skip the check.">
                  <div className="flex items-center gap-1.5">
                    <Input id="ss-gate" value={gate} onChange={(e) => setGate(e.target.value)} placeholder={suggested ?? 'e.g. pnpm test'} data-testid="gate-command" />
                    {suggested && !gate && (
                      <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 px-2 font-mono text-[11px]" onClick={() => setGate(suggested)} title="Fills the field; Save to keep it">
                        Use {suggested}
                      </Button>
                    )}
                  </div>
                </Field>
              </Section>

              <Section title="Agents & queue" description="Limits that keep usage and machine load in check.">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field id="ss-max" label="Most live agents" hint="The most Claude sessions open at once across this space's missions. Range 1 to 50." error={errors.max}>
                  <Input id="ss-max" type="number" inputMode="numeric" min={1} max={50} value={max} onChange={(e) => setMax(e.target.value)} aria-invalid={!!errors.max} aria-describedby={errors.max ? 'ss-max-error' : undefined} data-testid="max-live" />
                </Field>
                <Field id="ss-parallel" label="Queue parallelism" hint="How many queued tasks run at the same time. 1 runs them one after another. Range 1 to 10." error={errors.parallel}>
                  <Input id="ss-parallel" type="number" inputMode="numeric" min={1} max={10} value={parallel} onChange={(e) => setParallel(e.target.value)} aria-invalid={!!errors.parallel} aria-describedby={errors.parallel ? 'ss-parallel-error' : undefined} data-testid="max-parallel" />
                </Field>
                <Field id="ss-threshold" label="Pause the queue at plan usage (%)" hint="The queue waits once your 5-hour or weekly plan usage, whichever is higher, reaches this. Range 1 to 100." error={errors.threshold}>
                  <Input id="ss-threshold" type="number" inputMode="numeric" min={1} max={100} value={threshold} onChange={(e) => setThreshold(e.target.value)} aria-invalid={!!errors.threshold} aria-describedby={errors.threshold ? 'ss-threshold-error' : undefined} data-testid="usage-threshold" />
                </Field>
                <Field id="ss-idle" label="Auto-stop finished leads after (minutes)" hint="A team lead that has merged and sits idle this long is stopped. 0 turns this off. Range 0 to 1440." error={errors.idleStop}>
                  <Input id="ss-idle" type="number" inputMode="numeric" min={0} max={1440} value={idleStop} onChange={(e) => setIdleStop(e.target.value)} aria-invalid={!!errors.idleStop} aria-describedby={errors.idleStop ? 'ss-idle-error' : undefined} data-testid="idle-stop-minutes" />
                </Field>
                </div>
                <AutopilotToggle root={space.root} />
              </Section>

              <Section title="Models" description="Which Claude model each role uses in this space's missions. A role left empty uses the app default.">
                <ModelFields draft={models} onChange={setModels} label="Per-role models" />
              </Section>

              <Section title="Storage" description="Where mission records are kept.">
                <Field id="ss-records" label="Mission records folder" optional hint="Leave empty to keep records in The ORC's own data folder.">
                  <Input id="ss-records" value={records} onChange={(e) => setRecords(e.target.value)} placeholder={space.recordsDir ? '' : space.recordsPath} title={`Now: ${space.recordsPath}`} data-testid="records-dir" />
                </Field>
                <p className="text-[11.5px] leading-snug text-muted-foreground">
                  Currently <span className="break-all font-mono text-foreground">{space.recordsPath}</span>
                </p>
              </Section>

              <Section title="Notifications" description="Applies to this space only.">
                <label className="flex cursor-pointer items-start gap-2 text-[12px] font-medium leading-snug text-foreground">
                  <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="mt-0.5 accent-primary" data-testid="notifications-enabled" />
                  Notify me on the desktop when an agent needs me, finishes or exits
                </label>
              </Section>
            </fieldset>
          </div>

          <div className="border-t px-4 py-2.5">
            {error && <div role="alert" data-testid="space-settings-error" className="mb-2 rounded-md border border-destructive/40 px-2.5 py-1.5 text-[12px] text-destructive">Couldn't save: {error}</div>}
            {confirming ? (
              <div role="alertdialog" aria-labelledby="disconnect-title" data-testid="disconnect-confirm" className="space-y-2">
                <div>
                  <h3 id="disconnect-title" className="text-[12.5px] font-semibold">Disconnect {name}?</h3>
                  <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
                    The ORC forgets this repo, its settings and its stopped missions. Your files, branches and worktrees on disk are not touched, and you can connect the repo again any time.
                  </p>
                </div>
                {disconnectError && <div role="alert" data-testid="disconnect-error" className="rounded-md border border-destructive/40 px-2.5 py-1.5 text-[12px] text-destructive">Couldn't disconnect: {disconnectError}</div>}
                <div className="flex justify-end gap-1.5">
                  <Button type="button" size="sm" variant="ghost" className="h-7 text-muted-foreground hover:text-foreground" onClick={() => { setConfirming(false); setDisconnectError(null) }} disabled={disconnecting}>Keep repo</Button>
                  <Button type="button" size="sm" variant="destructive" className="h-7" onClick={() => void disconnect()} disabled={disconnecting} data-testid="disconnect-confirm-button">{disconnecting ? 'Disconnecting…' : 'Disconnect repo'}</Button>
                </div>
              </div>
            ) : (
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="ghost-destructive" className="h-7 px-2 text-[12px]" onClick={() => setConfirming(true)} disabled={saving} data-testid="space-disconnect">
                Disconnect repo
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[12px] text-muted-foreground hover:text-foreground" onClick={onRerunOnboarding} disabled={saving} title="Walk through the setup checks again (keeps the space enrolled until you save)" data-testid="space-rerun-onboarding">
                Re-run onboarding
              </Button>
              <div className="ml-auto flex gap-1.5">
                <Button type="button" size="sm" variant="ghost" className="h-7 text-muted-foreground hover:text-foreground" onClick={onClose} disabled={saving}>Cancel</Button>
                <Button type="submit" size="sm" className="h-7 min-w-24" disabled={saving || !valid}>{saving ? 'Saving…' : 'Save changes'}</Button>
              </div>
            </div>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
