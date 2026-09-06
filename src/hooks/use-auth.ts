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
 *     between the user clicking Discord and the browser callback
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

/**
 * Reasons that mean "the introspect *transport* failed", not "the
 * server rejected the token". When transport fails we keep the cached
 * session and let the next protected request decide. Reasons we
 * treat as transient:
 *   - `unreachable` — fetch threw (DNS / connection refused / offline)
 *   - `malformed`   — non-JSON body, e.g. an HTML error page from an
 *                     upstream proxy or a Vite HMR redirect
 *   - `http_5xx`    — server is up but unhappy
 *   - `http_429`    — rate limited; better to wait than to sign out
 * 401/403 + a meaningful reason (`expired`, `revoked`, `invalid`,
 * …) are treated as definitive and trigger a real sign-out.
 */
function isTransientReason(reason: string | null): boolean {
  if (!reason) return false
  if (reason === 'unreachable' || reason === 'malformed') return true
  if (/^http_(5\d\d|429)$/.test(reason)) return true
  return false
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
  // Failure handling splits two ways:
  //   - Definitive rejection — server returns `valid: false` with a
  //     reason we don't recognise as transient, or HTTP 401/403.
  //     The token is dead; clear it and drop to `'auth'`.
  //   - Transient failure — network error, CORS preflight fail, 5xx,
  //     non-JSON body. We *don't* clear the token. Optimistically
  //     mark the session authed and let the next protected call
  //     surface a real error if the server genuinely doesn't accept
  //     it. The previous behaviour of clearing the token on every
  //     failure bounced the user back to the login screen every time
  //     they hit F5 during a dev-server reload or a flaky upstream
  //     proxy — annoying on its own, but worse: it lost the cached
  //     display name / avatar from localStorage so they had to log
  //     back in from scratch.
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
            // Intentionally do NOT refresh `expiresAt` from the
            // introspect payload. The launcher treats the cached
            // session as never-expiring; the server stays the source
            // of truth by returning `valid: false` on the request
            // itself when the bearer is rejected, which the
            // definitive-rejection branch below already handles.
          })
          setStatus('authed')
          setError(null)
          return
        }

        const reason =
          'reason' in result && typeof result.reason === 'string'
            ? result.reason
            : null
        if (isTransientReason(reason)) {
          // Keep the token, render the home screen with whatever the
          // cached AuthToken says. Next protected call will surface
          // a real error if the server actually rejects the bearer.
          setStatus('authed')
          setError(null)
          return
        }
        // Definitive rejection: clear and bounce to login.
        clearPersistedToken()
        setToken(null)
        setStatus('auth')
        setError(reason ? `session_${reason}` : 'session_invalid')
      })
      .catch((err) => {
        if (cancelled) return
        // introspectToken already normalises fetch/json errors into
        // `{ valid: false, reason: ... }`, so a throw from inside the
        // promise chain is genuinely unexpected — log it loudly and
        // fall back to the optimistic-authed path so the user isn't
        // bounced out on a dev-server hiccup.
        console.warn('[auth] introspect threw unexpectedly', err)
        setStatus('authed')
        setError(null)
      })
    return () => {
      cancelled = true
    }
    // Depend on the bearer string rather than the full `token` object.
    // The `.then` block mutates the token in-place (refreshes
    // expiresAt/roles/etc.) which produces a new object reference;
    // depending on `token` would re-fire this effect every time and
    // loop introspect → setToken → introspect. The bearer is
    // immutable for the lifetime of a session — it only changes on
    // login/logout, which is exactly when we *want* to re-introspect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token?.token])

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