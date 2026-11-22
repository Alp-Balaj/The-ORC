import { formatKeys } from '../../lib/shortcuts'
import { cn } from '../../lib/utils'

/** A key combo as small key chips, e.g. 'Mod+Shift+N' -> [Ctrl][Shift][N]. */
export function Kbd({ keys, className }: { keys: string; className?: string }): React.JSX.Element {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-0.5', className)}>
      {formatKeys(keys).map((k, i) => (
        <kbd
          key={i}
          className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border-strong bg-secondary px-1 font-mono text-[10.5px] leading-none text-secondary-foreground"
        >
          {k}
        </kbd>
      ))}
    </span>
  )
}
