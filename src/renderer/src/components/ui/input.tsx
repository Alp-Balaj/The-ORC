import { cn } from '../../lib/utils'

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return (
    <input
      className={cn(
        'h-8 w-full rounded-md border px-2.5 text-[13px] border-border-strong bg-background hover:border-scrollbar-hover placeholder:text-faint transition-colors focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25',
        className
      )}
      {...props}
    />
  )
}

export function NativeSelect({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  return (
    <select
      className={cn(
        'h-8 w-full rounded-md border px-2 text-[13px] border-border-strong bg-background hover:border-scrollbar-hover placeholder:text-faint transition-colors focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25',
        className
      )}
      {...props}
    />
  )
}
