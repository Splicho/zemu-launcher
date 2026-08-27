import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import './lib/tauri-bridge'
import './lib/i18n'
import { LAUNCHER_CONFIG } from './config/launcher'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found')
}

void syncLauncherRuntimeConfig()

async function syncLauncherRuntimeConfig() {
  const isTauriRuntime = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  if (!isTauriRuntime) {
    return
  }

  try {
    const configuredProtocol = LAUNCHER_CONFIG.oauthCallbackProtocol.trim()
    if (configuredProtocol) {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('launcher_set_oauth_callback_protocol', { protocol: configuredProtocol })
    }
  } catch (error) {
    console.error('[launcher-config] failed to sync oauth callback protocol', error)
  }
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)