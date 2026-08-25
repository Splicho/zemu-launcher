import { useCallback, useEffect, useState } from 'react'

import {
  awaitOAuthCallback,
  clearPersistedToken,
  introspectToken,
  initiateOAuth,
  loginWithCredentials,
  persistToken,
  readPersistedToken,
  type AuthToken,
  type Provider,
} from '@/lib/auth'

/**
 * Top-level auth state machine for the renderer.
 *
 * State shape:
 *   - `token`: the persisted AuthToken (or null when signed out).
 *   - `status`: which screen we're rendering. `'loading'` during the
 *     startup introspect; `'auth'` to show the login screen; `'authed'`
 *     to render the home screen; `'exchanging'` for the brief window
 *     between the user clicking Discord/Steam and the browser callback
 *     landing.
 *
 * The hook is the only place that touches `lib/auth.ts` directly —
 * components import the hook and never call into the auth module
 * themselves. That keeps the storage side-effect in one place and lets
 * us swap to a React Query mutation later without touching the UI.
 */

export type AuthStatus = 'loading' | 'auth' | 'authed' | 'exchanging'

export interface UseAuthResult {
  token: AuthToken | null
  status: AuthStatus
  error: string | null

  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  loginWithProvider: (
    provider: Provider,
  ) => Promise<{ success: boolean; error?: string }>
  logout: () => void
}

/**
 * Read the persisted token once, at hook initialization time. Used as
 * a `useState` initializer so the synchronous read doesn't trigger
 * the `react-hooks/set-state-in-effect` rule (no setState inside an
 * effect body — the state just starts pre-loaded).
 */
function readInitialToken(): AuthToken | null {
  return readPersistedToken()
}

export function useAuth(): UseAuthResult {
  // Initialise from localStorage synchronously (runs once, before the
  // first render). This avoids an effect that sets state for the
  // "no persisted token" branch.
  const [token, setToken] = useState<AuthToken | null>(readInitialToken)
  const [status, setStatus] = useState<AuthStatus>(() =>
    token ? 'loading' : 'auth',
  )
  const [error, setError] = useState<string | null>(null)

  // Startup: if we have a persisted token, hit introspect to confirm
  // it's still valid (server-side expiry, secret rotation, etc.) before
  // showing the home screen. Without this we'd happily render the home
  // screen with a token the server rejects on first call. The
  // "no persisted token" case is already handled by the `useState`
  // initializer above.
  //
  // We persist the flat `AuthToken` shape (what the Rust side stores)
  // but the introspect endpoint returns the user record nested. Map the
  // introspect payload onto our stored token so the rest of the app
  // sees a single shape.
  //
  // Failure handling: any introspect error (network, CORS, 5xx, invalid
  // token) drops us to `'auth'`. An earlier version optimistically
  // rendered the home page on introspect failure, but that left users
  // stuck when the auth server was unreachable for a different reason
  // (e.g. CORS misconfigured) — the home page would render but every
  // protected call would 401, with no path back to the login screen
  // short of restarting the app. Clearing the token on failure is the
  // safer default; the user just has to log in again. A stale-token
  // auto-resume can be added later behind a more conservative check
  // (e.g. distinguish transient network failure from server rejection).
  useEffect(() => {
    if (!token) return

    let cancelled = false
    introspectToken(token.token)
      .then((result) => {
        if (cancelled) return
        if (result.valid && result.user) {
          setToken({
            ...token,
            userId: result.user.id,
            email: result.user.email,
            displayName: result.user.displayName,
            username: result.user.name,
            image: result.user.image,
            provider: result.user.provider,
            roles: result.user.roles,
            permissions: result.user.permissions,
            expiresAt: result.expiresAt ?? token.expiresAt,
          })
          setStatus('authed')
          setError(null)
        } else {
          clearPersistedToken()
          setToken(null)
          setStatus('auth')
          // `valid: false` with a `reason` is the server telling us the
          // token was rejected (expired, revoked, signature mismatch).
          // Surface it so the login page can explain why we're here.
          const reason =
            'reason' in result && typeof result.reason === 'string'
              ? result.reason
              : null
          setError(reason ? `session_${reason}` : 'session_invalid')
        }
      })
      .catch((err) => {
        if (cancelled) return
        // Introspect call failed at the transport layer (network down,
        // CORS preflight rejected, DNS error, etc.). We can't tell
        // those apart from here — any of them means we can't confirm
        // the token is good, so sign out rather than risk rendering
        // HomePage with a token the server will reject on first use.
        console.warn('[auth] introspect failed, signing out', err)
        clearPersistedToken()
        setToken(null)
        setStatus('auth')
        setError('session_unreachable')
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const login = useCallback(async (email: string, password: string) => {
    setError(null)
    try {
      const next = await loginWithCredentials(email, password)
      persistToken(next)
      setToken(next)
      setStatus('authed')
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed'
      setError(message)
      return { success: false, error: message }
    }
  }, [])

  const loginWithProvider = useCallback(async (provider: Provider) => {
    setError(null)
    setStatus('exchanging')
    try {
      const { state } = await initiateOAuth(provider)
      const next = await awaitOAuthCallback(state)
      persistToken(next)
      setToken(next)
      setStatus('authed')
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'OAuth failed'
      setError(message)
      setStatus('auth')
      return { success: false, error: message }
    }
  }, [])

  const logout = useCallback(() => {
    clearPersistedToken()
    setToken(null)
    setStatus('auth')
    setError(null)
  }, [])

  return { token, status, error, login, loginWithProvider, logout }
}