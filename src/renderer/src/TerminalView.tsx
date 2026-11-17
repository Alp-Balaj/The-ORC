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
      theme: { background: '#0b0d10' }
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
    const observer = new ResizeObserver(sync)
    observer.observe(ref.current!)
    sync()

    return () => {
      disposed = true
      offData()
      input.dispose()
      observer.disconnect()
      term.dispose()
    }
  }, [id])

  return <div className="terminal" ref={ref} />
}
