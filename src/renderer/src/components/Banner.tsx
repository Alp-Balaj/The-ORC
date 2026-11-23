import { AlertTriangle, X } from 'lucide-react'
import { Button } from './ui/button'

// One-line destructive banner under the header: the failure banner and the action-error banner.
export function Banner({
  text,
  testId,
  onDismiss,
  action,
  ...rest
}: {
  text: string
  testId: string
  onDismiss?: () => void
  action?: { label: string; onClick: () => void; testId?: string }
  'data-kind'?: string
}): React.JSX.Element {
  return (
    <div className="flex min-h-9 shrink-0 items-center gap-2 border-b border-destructive/40 bg-destructive/5 px-3 py-1 text-[12px]" role="alert" data-testid={testId} {...rest}>
      <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
      <span className="min-w-0 flex-1 truncate text-foreground" title={text}>{text}</span>
      {action && (
        <Button size="xs" variant="outline" className="shrink-0" data-testid={action.testId} onClick={action.onClick}>
          {action.label}
        </Button>
      )}
      {onDismiss && (
        <Button size="icon-sm" variant="ghost" className="shrink-0" onClick={onDismiss} aria-label="Dismiss">
          <X />
        </Button>
      )}
    </div>
  )
}
