import { useEffect, useId, useRef, useState } from 'react'
import { Keyboard, SlidersHorizontal } from 'lucide-react'
import { ModelRoles, type MissionView } from '../../../shared/types'
import { cn, formatTokens } from '../lib/utils'
import { withHint } from '../lib/shortcuts'
import { roleLabel } from './ModelFields'
import { AccentPicker } from './AccentPicker'
import { PlanUsageHeader } from './PlanUsageHeader'
import { ThemeToggle } from './ThemeToggle'
import { Button } from './ui/button'

const modeLabel: Record<string, string> = {
  acceptEdits: 'accept edits',
  auto: 'auto',
  manual: 'ask for everything',
  bypassPermissions: 'bypass permissions',
  dontAsk: "don't ask"
}
const gatingLabel = { plan: 'plan check', checkpointed: 'checkpointed', none: 'no check' } as const

function Section({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="px-3 py-2">
      <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wider text-faint">{label}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}
function Row({ label, children, title, testId }: { label: string; children: React.ReactNode; title?: string; testId?: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 text-[12px]" title={title}>
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right" data-testid={testId}>{children}</span>
    </div>
  )
}

/** One muted header button that opens a popover with the per-mission config readouts and app-wide settings. */
export function HeaderSettingsMenu({ mission, warnAt, onShortcuts }: { mission: MissionView | null; warnAt: number; onShortcuts: () => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault() // keeps App's Escape-leaves-screen handler from also firing
      e.stopPropagation()
      setOpen(false)
      root.current?.querySelector<HTMLElement>("[data-testid=header-settings]")?.focus()
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div ref={root} className="relative shrink-0">
      <Button
        size="icon-sm"
        variant="ghost"
        className={cn('text-muted-foreground', open && 'bg-selected text-foreground')}
        title="Settings"
        aria-label="Settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        data-testid="header-settings"
        onClick={() => setOpen((v) => !v)}
      >
        <SlidersHorizontal />
      </Button>
      {open && (
        <div id={id} role="dialog" aria-label="Settings" data-testid="header-settings-menu" className="absolute right-0 top-full z-50 mt-1.5 w-72 divide-y rounded-lg border bg-card py-1 text-card-foreground shadow-lg">
          {mission && (
            <Section label="Mission">
              <Row label="Permissions" title="Every session in this mission uses this permission mode">{modeLabel[mission.permissionMode] ?? mission.permissionMode}</Row>
              <Row label="Model" testId="header-models" title={ModelRoles.map((r) => `${roleLabel[r]}: ${mission.models[r] ?? (r === 'advisor' ? 'none' : 'default')}`).join('\n')}>
                {mission.models.coordinator ?? 'default'}
                {mission.models.subagent && mission.models.subagent !== mission.models.coordinator && <span className="text-faint"> · sub {mission.models.subagent}</span>}
                {mission.models.advisor && <span className="text-faint"> · adv {mission.models.advisor}</span>}
              </Row>
              <Row label="Gating" testId="gating" title="Gating mode">{gatingLabel[mission.gating]}</Row>
              <Row label="Tokens" title="Tokens used by every session in this mission (input + cache writes + output)"><span className="tabular-nums">{formatTokens(mission.tokens)}</span></Row>
            </Section>
          )}
          <Section label="Plan usage">
            <PlanUsageHeader warnAt={warnAt} className="flex-col items-stretch gap-1.5" />
          </Section>
          <Section label="Appearance">
            <Row label="Theme"><ThemeToggle /></Row>
            <Row label="Accent"><AccentPicker /></Row>
          </Section>
          <div className="px-1.5 pt-1">
            <Button variant="ghost" size="sm" className="w-full justify-start text-[12px] text-muted-foreground" title={withHint('Keyboard shortcuts', 'shortcuts')} data-testid="open-shortcuts" onClick={() => { setOpen(false); onShortcuts() }}>
              <Keyboard /> Keyboard shortcuts
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
