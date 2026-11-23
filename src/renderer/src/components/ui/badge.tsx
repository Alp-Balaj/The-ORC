import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const badgeVariants = cva('inline-flex h-4.5 items-center gap-1 rounded-[5px] px-1.5 text-[11px] font-medium leading-4', {
  variants: {
    variant: {
      default: 'bg-secondary text-secondary-foreground',
      outline: 'border border-border-strong text-muted-foreground',
      working: 'bg-working/12 text-working ring-1 ring-inset ring-working/20',
      idle: 'bg-muted text-muted-foreground ring-1 ring-inset ring-border',
      starting: 'bg-muted text-muted-foreground ring-1 ring-inset ring-border',
      'needs-you': 'bg-needs/15 text-needs ring-1 ring-inset ring-needs/35 font-semibold',
      done: 'bg-done/12 text-done ring-1 ring-inset ring-done/20',
      exited: 'bg-exited/40 text-exited-foreground ring-1 ring-inset ring-exited'
    }
  },
  defaultVariants: { variant: 'default' }
})

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>): React.JSX.Element {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
