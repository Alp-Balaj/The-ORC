import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@xterm/xterm/css/xterm.css'
import './app.css'
import { initTheme } from './lib/theme'
import { initBackground } from './lib/background'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'

initTheme()
initBackground()

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
