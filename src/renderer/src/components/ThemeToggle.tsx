import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { getThemePref, onThemeChange, setThemePref, type ThemePref } from '../lib/theme'
import { Button } from './ui/button'
import { ButtonGroup } from './ui/button-group'

const options: { pref: ThemePref; label: string; Icon: typeof Sun }[] = [
  { pref: 'light', label: 'Light theme', Icon: Sun },
  { pref: 'dark', label: 'Dark theme', Icon: Moon },
  { pref: 'system', label: 'Match system', Icon: Monitor },
]

export function ThemeToggle({ className }: { className?: string }): React.JSX.Element {
  const [pref, setPref] = useState<ThemePref>(getThemePref)
  useEffect(() => onThemeChange((_resolved, p) => setPref(p)), [])
  return (
    <ButtonGroup className={className} data-testid="theme-toggle">
      {options.map(({ pref: p, label, Icon }) => (
        <Button
          key={p}
          variant="ghost"
          size="icon-sm"
          className={pref === p ? 'bg-selected text-foreground' : undefined}
          title={label}
          aria-label={label}
          aria-pressed={pref === p}
          onClick={() => {
            setThemePref(p)
            setPref(p)
          }}
        >
          <Icon />
        </Button>
      ))}
    </ButtonGroup>
  )
}
