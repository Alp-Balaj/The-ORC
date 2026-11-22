import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium transition-[color,background-color,border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5 [&_svg]:shrink-0 cursor-pointer',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]',
        destructive: 'bg-destructive/12 text-destructive border border-destructive/30 hover:bg-destructive/20',
        outline: 'border border-border-strong bg-transparent text-foreground hover:bg-accent',
        ghost: 'text-muted-foreground hover:bg-accent hover:text-foreground',
        secondary: 'bg-secondary text-secondary-foreground border border-border hover:bg-accent',
        'ghost-destructive': 'text-muted-foreground hover:bg-destructive/12 hover:text-destructive'
      },
      size: {
        default: 'h-8 px-3',
        sm: 'h-7 px-2.5 text-xs',
        xs: 'h-6 px-2 text-[11px] [&_svg]:size-3',
        icon: 'size-7',
        'icon-sm': 'size-6'
      }
    },
    defaultVariants: { variant: 'default', size: 'default' }
  }
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps): React.JSX.Element {
  return <button className={cn(buttonVariants({ variant, size, className }))} {...props} />
}
