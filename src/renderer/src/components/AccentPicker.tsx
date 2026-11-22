import { useEffect, useState } from 'react'
import { ACCENTS, getAccent, onAccentChange, setAccent, type Accent } from '../lib/accent'
import { cn } from '../lib/utils'

export function AccentPicker({ className }: { className?: string }): React.JSX.Element {
  const [accent, setLocal] = useState<Accent>(getAccent)
  useEffect(() => onAccentChange(setLocal), [])
  return (
    <div role="group" aria-label="Accent colour" className={cn('flex items-center gap-1', className)} data-testid="accent-picker">
      {ACCENTS.map(({ id, label, swatch }) => (
        <button
          key={id}
          type="button"
          title={label}
          aria-label={`${label} accent`}
          aria-pressed={accent === id}
          data-testid={`accent-${id}`}
          onClick={() => setAccent(id)}
          className={cn(
            'size-3.5 shrink-0 rounded-full outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring',
            accent === id ? 'ring-2 ring-foreground/70 ring-offset-2 ring-offset-background' : 'hover:ring-2 hover:ring-border-strong'
          )}
          style={{ backgroundColor: swatch }}
        />
      ))}
    </div>
  )
}
