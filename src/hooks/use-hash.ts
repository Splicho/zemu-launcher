import { useEffect, useState } from 'react'

/**
 * Tiny hash router hook. Watches `window.location.hash` and returns
 * the current value as a string (without the leading `#`). Updates
 * on the native `hashchange` event.
 *
 * The zemu-launcher uses location.hash to switch between the
 * bootstrap updater window (`#/bootstrap`, loaded by Tauri's
 * bootstrap window config) and the main auth/home window
 * (`#/` or `#/...anything-else`). Both windows load the same React
 * bundle from `index.html` — the hash is what tells the renderer
 * which page to render.
 *
 * Returns `null` until the hook has read the initial value. Callers
 * should handle that explicitly — the bootstrap page uses this to
 * gate the updater call until we know we're on the right hash.
 */
export function useHash(): string | null {
  const [hash, setHash] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return window.location.hash.replace(/^#/, '') || '/'
  })

  useEffect(() => {
    const onChange = () => {
      setHash(window.location.hash.replace(/^#/, '') || '/')
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  return hash
}

/**
 * Like `useHash`, but also exposes `navigate(to)` which sets the
 * hash without forcing a full reload (Tauri's webview reloads on
 * `window.location.assign`, which would tear down React state).
 *
 * Use this anywhere you need to push a route change in response to
 * a React state transition (e.g. "redirect to login when signed
 * out", "navigate to intended route after sign-in").
 */
export function useHashRouter(): {
  hash: string | null
  navigate: (to: string) => void
} {
  const hash = useHash()
  const navigate = (to: string) => {
    const next = to.startsWith('#') ? to : `#${to}`
    if (window.location.hash !== next) {
      window.location.hash = next
    }
  }
  return { hash, navigate }
}