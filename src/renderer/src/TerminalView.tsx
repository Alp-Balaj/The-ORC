import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

/** Shows one host terminal. Re-mounting with another id replays that
 *  terminal's buffered output, so switching between agents is lossless. */
export function TerminalView({ id }: { id: string }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const term = new Terminal({
      fontFamily: 'JetBrainsMono Nerd Font, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: { background: '#0a0c0f' }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(ref.current!)
    fit.fit()

    let disposed = false
    void window.orc.replay(id).then((buffered) => {
      if (!disposed) term.write(buffered)
    })
    const offData = window.orc.onData((tid, data) => {
      if (tid === id) term.write(data)
    })
    const input = term.onData((data) => window.orc.write(id, data))
    const sync = (): void => {
      fit.fit()
      window.orc.resize(id, term.cols, term.rows)
    }
    // Fit on the next frame, not inside the observer callback: fitting resizes the observed
    // element, and doing it synchronously trips "ResizeObserver loop completed…" (seen on
    // Windows, where scrollbars take layout width).
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(sync)
    })
    observer.observe(ref.current!)
    sync()

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      offData()
      input.dispose()
      observer.disconnect()
      term.dispose()
    }
  }, [id])

  return <div className="min-h-0 flex-1 p-1.5" data-testid="terminal" ref={ref} />
}
