import { useEffect, useState } from 'react'
import { TerminalView } from './TerminalView'

export function App(): React.JSX.Element {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    void window.orc.startShell('shell').then(() => setReady(true))
  }, [])
  return <div className="layout">{ready && <TerminalView id="shell" />}</div>
}
