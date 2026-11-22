import { cn } from '../../lib/utils'

export function ButtonGroup({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div role="group" className={cn('inline-flex items-center rounded-md border border-border bg-background p-0.5 gap-0.5', className)} {...props} />
}
