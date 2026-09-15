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
    const { invoke } = await import('@tauri-apps/api/core')

    const configuredProtocol = LAUNCHER_CONFIG.oauthCallbackProtocol.trim()
    if (configuredProtocol) {
      await invoke('launcher_set_oauth_callback_protocol', { protocol: configuredProtocol })
    }

    // Tell the Rust side the realtime socket URL so it can start the
    // friends socket loop without mirroring Vite env vars. Dev default is
    // ws://localhost:3007; prod default is wss://socket.zemu.uk.
    //
    // The `import.meta.env` lookup is gated on DEV so a leftover
    // `VITE_LAUNCHER_REALTIME_URL` in `.env.local` does NOT leak into a
    // production bundle — Vite still loads `.env.local` for `vite build`
    // because there is no `.env.production.local` to shadow it, and a
    // stray dev value there would point the production app at
    // `ws://localhost:3007` (unreachable from end users). Production
    // builds always use the bundled `LAUNCHER_CONFIG.realtimeUrl`.
    const fromEnv = import.meta.env.VITE_LAUNCHER_REALTIME_URL as string | undefined
    const realtimeUrl =
      import.meta.env.DEV && fromEnv
        ? fromEnv
        : LAUNCHER_CONFIG.realtimeUrl
    await invoke('launcher_set_realtime_url', { url: realtimeUrl })
  } catch (error) {
    console.error('[launcher-config] failed to sync config with Rust backend', error)
  }
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)