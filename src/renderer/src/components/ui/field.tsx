import { cn } from '../../lib/utils'

/** A titled group of fields with an optional one-line plain-language description. */
export function FormSection({ title, description, children, className }: { title: string; description?: string; children: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <section className={cn('space-y-3', className)}>
      <div className="space-y-0.5 border-b pb-1.5">
        <h3 className="section-title">{title}</h3>
        {description && <p className="text-[11.5px] leading-snug text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  )
}

/** Label + control + helper text; the error replaces the helper in red. Give the control `aria-invalid` and `aria-describedby={`${id}-error`}`. */
export function Field({ id, label, hint, error, optional, children, className }: { id: string; label: string; hint?: string; error?: string | null; optional?: boolean; children: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-[12px] font-medium text-foreground">
        {label}
        {optional && <span className="ml-1 font-normal text-faint">(optional)</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[11.5px] leading-snug text-destructive">{error}</p>
      ) : (
        hint && <p className="text-[11.5px] leading-snug text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}
