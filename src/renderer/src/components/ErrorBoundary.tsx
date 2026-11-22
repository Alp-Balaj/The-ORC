import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RotateCcw, TriangleAlert } from 'lucide-react'
import { Button } from './ui/button'

/** A render error must never leave a blank window: sessions keep running in the main
 *  process, so offer a reload (which reattaches to them). */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('UI crashed', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="grid h-full place-items-center p-8" data-testid="ui-error">
        <div className="max-w-lg rounded-lg border border-destructive/40 bg-card p-5">
          <div className="flex items-center gap-2 font-semibold text-destructive">
            <TriangleAlert className="size-4" /> The ORC's window hit an error
          </div>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Your sessions are still running: they live in the app's main process, not in this window. Reloading reconnects to them.
          </p>
          <pre className="mt-3 max-h-40 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-[11px] text-muted-foreground">{String(this.state.error.stack ?? this.state.error)}</pre>
          <Button className="mt-3" onClick={() => location.reload()}><RotateCcw /> Reload the window</Button>
        </div>
      </div>
    )
  }
}
