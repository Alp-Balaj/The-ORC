import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { BACKGROUNDS, getBackground, onBackgroundChange, setBackground } from '../lib/background'
import { getResolvedTheme } from '../lib/theme'
import { cn } from '../lib/utils'

/** Palettes for the current light/dark mode, as two-tone swatches (page background over raised surface). */
export function BackgroundPicker({ className }: { className?: string }): React.JSX.Element {
  const [, bump] = useState(0)
  useEffect(() => onBackgroundChange(() => bump((n) => n + 1)), [])
  const mode = getResolvedTheme()
  const current = getBackground(mode)
  const light = mode === 'light'
  return (
    <div role="group" aria-label="Background" className={cn('flex items-center gap-1.5', className)} data-testid="background-picker">
      {BACKGROUNDS.filter((b) => b.mode === mode).map(({ id, label, bg, card }) => {
        const selected = current === id
        return (
          <button
            key={id}
            type="button"
            title={label}
            aria-label={`${label} background`}
            aria-pressed={selected}
            data-testid={`background-${id}`}
            onClick={() => setBackground(id)}
            className={cn(
              'relative size-5 shrink-0 overflow-hidden rounded-md border border-border-strong outline-none transition-shadow',
              'focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-ring',
              selected ? 'ring-2 ring-foreground ring-offset-2 ring-offset-card' : 'hover:ring-2 hover:ring-foreground/30 hover:ring-offset-2 hover:ring-offset-card'
            )}
            style={{ backgroundColor: bg }}
          >
            <span className="absolute inset-x-0.5 bottom-0.5 h-2 rounded-sm" style={{ backgroundColor: card }} />
            {selected && <Check className={cn('absolute inset-0 m-auto size-2.5', light ? 'text-black/70' : 'text-white/90')} strokeWidth={3.5} aria-hidden />}
          </button>
        )
      })}
    </div>
  )
}
