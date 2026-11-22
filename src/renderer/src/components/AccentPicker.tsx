import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { ACCENTS, getAccent, onAccentChange, setAccent, type Accent } from '../lib/accent'
import { cn } from '../lib/utils'

/** Check-mark colour per swatch: dark on the light swatches (amber, green, teal), white elsewhere. */
const DARK_CHECK = new Set<Accent>(['amber', 'green', 'teal'])

export function AccentPicker({ className }: { className?: string }): React.JSX.Element {
  const [accent, setLocal] = useState<Accent>(getAccent)
  useEffect(() => onAccentChange(setLocal), [])
  return (
    <div role="group" aria-label="Accent colour" className={cn('flex items-center gap-1', className)} data-testid="accent-picker">
      {ACCENTS.map(({ id, label, swatch }) => {
        const selected = accent === id
        return (
          <button
            key={id}
            type="button"
            title={label}
            aria-label={`${label} accent`}
            aria-pressed={selected}
            data-testid={`accent-${id}`}
            onClick={() => setAccent(id)}
            // Selected: 2px foreground ring, 2px gap in the header background (reads on every swatch, both themes).
            // Focus-visible: a ring-coloured outline, offset further out, so it differs from the selected ring.
            className={cn(
              'flex size-3.5 shrink-0 items-center justify-center rounded-full outline-none transition-shadow',
              'focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-ring',
              selected ? 'ring-2 ring-foreground ring-offset-2 ring-offset-background' : 'hover:ring-2 hover:ring-foreground/30 hover:ring-offset-2 hover:ring-offset-background'
            )}
            style={{ backgroundColor: swatch }}
          >
            {selected && <Check className={cn('size-2', DARK_CHECK.has(id) ? 'text-black/75' : 'text-white')} strokeWidth={3.5} aria-hidden />}
          </button>
        )
      })}
    </div>
  )
}
