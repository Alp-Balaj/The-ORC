import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

/** Shows one host terminal. Re-mounting with another id replays that
 *  terminal's buffered output, so switching between agents is lossless.
 *  Copy: select with the mouse, then Ctrl+C (Ctrl+C with nothing selected still interrupts),
 *  Ctrl+Shift+C, or right-click. */
export function TerminalView({ id }: { id: string }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const term = new Terminal({
      fontFamily: 'JetBrainsMono Nerd Font, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: '#0b0b0d',
        foreground: '#d8dadf',
        cursor: '#e6e7ea',
        cursorAccent: '#0b0b0d',
        selectionBackground: '#6a6df055',
        selectionInactiveBackground: '#6a6df030',
        scrollbarSliderBackground: '#2a2c3180',
        scrollbarSliderHoverBackground: '#3a3c42',
        scrollbarSliderActiveBackground: '#3a3c42',
        black: '#1c1d21',
        red: '#eb5757',
        green: '#4cc38a',
        yellow: '#f5a524',
        blue: '#6ea8fe',
        magenta: '#b18cf7',
        cyan: '#4cc9d8',
        white: '#c9ccd3',
        brightBlack: '#5f626a',
        brightRed: '#ff7b7b',
        brightGreen: '#6fdca6',
        brightYellow: '#ffc053',
        brightBlue: '#93bfff',
        brightMagenta: '#c9acff',
        brightCyan: '#7adfe9',
        brightWhite: '#f0f1f3'
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    const el = ref.current!
    term.open(el)
    // The replay selects text through this to test copying.
    Object.assign(el, { orcTerm: term })
    fit.fit()

    let disposed = false
    void window.orc.replay(id).then((buffered) => {
      if (!disposed) term.write(buffered)
    })
    const offData = window.orc.onData((tid, data) => {
      if (tid === id) term.write(data)
    })
    const input = term.onData((data) => window.orc.write(id, data))
    const copySelection = (): boolean => {
      if (!term.hasSelection()) return false
      window.orc.copyText(term.getSelection())
      term.clearSelection()
      return true
    }
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'c') return true
      // Ctrl+Shift+C never reaches the session; Ctrl+C does only when nothing is selected.
      if (copySelection() || e.shiftKey) {
        e.preventDefault()
        return false
      }
      return true
    })
    const onContextMenu = (e: MouseEvent): void => {
      if (copySelection()) e.preventDefault()
    }
    el.addEventListener('contextmenu', onContextMenu)
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
    observer.observe(el)
    sync()

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      offData()
      input.dispose()
      el.removeEventListener('contextmenu', onContextMenu)
      observer.disconnect()
      term.dispose()
    }
  }, [id])

  return <div className="min-h-0 flex-1 p-1.5" data-testid="terminal" ref={ref} />
}
