import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const badgeVariants = cva('inline-flex items-center gap-1 rounded-sm px-1.5 py-px text-[11px] font-medium leading-4', {
  variants: {
    variant: {
      default: 'bg-secondary text-secondary-foreground',
      outline: 'border border-border text-muted-foreground',
      working: 'bg-working/15 text-working',
      idle: 'bg-muted text-muted-foreground',
      starting: 'bg-muted text-muted-foreground',
      'needs-you': 'bg-needs/15 text-needs',
      done: 'bg-done/15 text-done',
      exited: 'bg-exited/20 text-exited-foreground'
    }
  },
  defaultVariants: { variant: 'default' }
})

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>): React.JSX.Element {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
