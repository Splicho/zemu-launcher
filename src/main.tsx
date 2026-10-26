import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import './lib/tauri-bridge'
import './lib/i18n'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found')
}

// Packaged launcher builds behave like a native app, not a browser:
// suppress the WebView context menu (back, reload, inspect, save image).
// Leave it enabled during development so DevTools stays reachable.
if (!import.meta.env.DEV) {
  window.addEventListener('contextmenu', event => event.preventDefault())
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
