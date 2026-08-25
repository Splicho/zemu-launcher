/**
 * Auth client for the desktop launcher.
 *
 * Three things live here:
 *
 *   1. The runtime config (API base URL, OAuth callback protocol) —
 *      pulled from `LAUNCHER_CONFIG` so it's a single source of truth
 *      with the bundled update-config.json. The Rust side overrides
 *      `apiBaseUrl` at build time; here we read it from a Tauri global
 *      injected at boot, falling back to the compile-time default.
 *
 *   2. The credential login flow — a plain POST to
 *      `/api/launcher/auth/login`, returning the bearer JWT + user
 *      payload. Pure HTTP, works from the renderer without any
 *      native bridging.
 *
 *   3. The OAuth entry point — generates a CSRF state, then asks the
 *      Rust side to open the user's default browser to the
 *      `/api/launcher/oauth/initiate` URL. The Rust OAuth server (see
 *      src-tauri/src/oauth_server.rs, pending) listens for the
 *      resulting `zemu-launcher://oauth/callback?token=...` deep link
 *      and forwards the token back into the renderer over a Tauri
 *      event. The renderer-side wiring for that listener lives in
 *      `useAuth().completeOAuth()`.
 */

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import { LAUNCHER_CONFIG } from '@/config/launcher'

export type Provider = 'discord' | 'steam'

export interface LauncherUser {
  id: string
  email: string
  displayName: string | null
  name: string | null
  image: string | null
  provider: string | null
  roles: string[]
  permissions: string[]
}

// Rust serializes `models::AuthToken` via `#[serde(rename_all = "camelCase")]`,
// so the JSON the renderer receives is a flat object with `userId`,
// `displayName`, `expiresAt`, etc. — not the nested `user` shape. Keep
// the field names here 1:1 with the Rust struct so `invoke<AuthToken>`
// typechecks.
export interface AuthToken {
  token: string
  userId: string
  email: string
  username: string | null
  displayName: string | null
  role: string | null
  roles: string[] | null
  permissions: string[] | null
  provider: string | null
  image: string | null
  expiresAt: number | null // unix milliseconds; nullable until introspected
}

/**
 * Same shape as `AuthToken` but typed for the website's
 * `/api/launcher/oauth/introspect` and `/api/launcher/user` endpoints,
 * which return the user record nested under a `user` key. The launcher
 * only uses this shape at startup (introspect) — the Rust side
 * flattens the same data into `AuthToken` for storage.
 */
export interface IntrospectResponse {
  valid: boolean
  user?: LauncherUser
  expiresAt?: number
  secondsUntilExpiry?: number
}

const TOKEN_STORAGE_KEY = 'zemu-launcher.auth'

// The OAuth `state` is generated and registered by Rust
// (`auth::open_oauth` → `auth::generate_oauth_state`) — the renderer
// only receives it back via the `auth_open_oauth` command result and
// uses it to correlate the eventual `oauth-callback` event.

/**
 * Read the auth token from localStorage. Returns null if missing or
 * expired (the launcher should re-prompt the user when this returns
 * null rather than treating null as "never signed in").
 *
 * `expiresAt` is in milliseconds (matches the Rust side's
 * `Utc::now().timestamp_millis()`). When it's null we treat the token
 * as never-expiring; the Rust OAuth server returns `expiresAt: None`
 * for tokens minted by `auth_complete_oauth_token`, so we let those
 * through and rely on the next introspect round-trip to refresh the
 * value.
 */
export function readPersistedToken(): AuthToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AuthToken
    if (
      typeof parsed?.expiresAt === 'number' &&
      parsed.expiresAt < Date.now()
    ) {
      localStorage.removeItem(TOKEN_STORAGE_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function persistToken(token: AuthToken): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(token))
}

export function clearPersistedToken(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY)
}

/**
 * Resolve the auth API base URL.
 *
 * Precedence (first wins):
 *   1. `VITE_API_BASE_URL` set in `.env.local` (Vite dev only; ignored in
 *      production builds because Vite only exposes `import.meta.env.VITE_*`
 *      vars at build time, and the bundle is built with the empty default).
 *      Use this to point the dev launcher at a local checkout of
 *      `zemu-website/apps/auth` so you don't have to round-trip through
 *      `id.zemu.uk` while developing.
 *   2. Rust's `get_api_base_url` command — Tauri's production injection
 *      point. In dev Tauri's webview also runs `get_api_base_url`, so if
 *      the Rust side has been configured to override (see
 *      `LAUNCHER_CONFIG.apiBaseUrl` and the `launcher_set_api_base_url`
 *      Tauri command) that takes precedence over the env var.
 *   3. `LAUNCHER_CONFIG.apiBaseUrl` — the bundled default, `id.zemu.uk`
 *      in the published build.
 */
async function getApiBaseUrl(): Promise<string> {
  const fromEnv = import.meta.env.VITE_API_BASE_URL as string | undefined
  if (import.meta.env.DEV && fromEnv) return fromEnv
  try {
    const fromRust = await invoke<string | null>('get_api_base_url')
    return fromRust ?? LAUNCHER_CONFIG.apiBaseUrl
  } catch {
    return LAUNCHER_CONFIG.apiBaseUrl
  }
}

/**
 * POST /api/launcher/auth/login. Returns the bearer JWT + user on
 * success; throws an Error with the server's `error` field as message
 * on any non-2xx.
 *
 * The endpoint returns the same shape as `/api/launcher/oauth/introspect`
 * (`{ token, expiresAt, user: { … } }`). We flatten that into the
 * `AuthToken` shape that the launcher actually persists, so the OAuth
 * and credentials flows end up writing the same on-disk token shape.
 */
export async function loginWithCredentials(
  email: string,
  password: string,
): Promise<AuthToken> {
  const base = await getApiBaseUrl()
  const response = await fetch(`${base}/api/launcher/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const payload = (await response.json().catch(() => ({}))) as {
    token?: string
    expiresAt?: number
    user?: LauncherUser
    error?: string
  }
  if (!response.ok || !payload.token || !payload.user) {
    throw new Error(payload.error ?? `Login failed (HTTP ${response.status})`)
  }
  return {
    token: payload.token,
    userId: payload.user.id,
    email: payload.user.email,
    displayName: payload.user.displayName,
    username: payload.user.name,
    image: payload.user.image,
    provider: payload.user.provider,
    roles: payload.user.roles,
    permissions: payload.user.permissions,
    role: null,
    expiresAt: payload.expiresAt ?? null,
  }
}

/**
 * Start the OAuth flow. Hands the provider off to the Rust side, which
 * registers a CSRF state, builds the `/api/launcher/oauth/initiate` URL,
 * and opens it in the OS default browser via `webbrowser::open`. The
 * Rust command returns the `state` it registered so the caller can
 * correlate the eventual `oauth-callback` event with this flow.
 *
 * Note: the callback handling happens in `awaitOAuthCallback` — call
 * both in sequence.
 */
export async function initiateOAuth(provider: Provider): Promise<{ state: string }> {
  // `auth_open_oauth` lives in src-tauri/src/commands.rs and is the
  // single source of truth for OAuth state generation + URL building +
  // browser handoff. Doing any of that from the renderer would mean
  // re-registering the state across two storage locations; keep it on
  // the Rust side instead.
  const isDevRuntime = import.meta.env.DEV
  const result = await invoke<{ success: boolean; error?: string; state?: string }>(
    'auth_open_oauth',
    { provider, isDevRuntime },
  )
  if (!result.success || !result.state) {
    throw new Error(result.error ?? `Failed to start ${provider} OAuth flow`)
  }
  return { state: result.state }
}

/**
 * Wait for the OAuth callback. The Rust OAuth server (running on
 * `127.0.0.1:31337` in dev) or the deep-link plugin (in production)
 * emits `oauth-callback` Tauri events with `{ token, state, error }`
 * whenever the OAuth dance completes. We resolve on the first event
 * matching the `state` we generated.
 *
 * Returns the AuthToken on success, or throws on `error` in the event.
 * The caller is expected to have a timeout — Rust side will not
 * auto-reject if the user closes the browser mid-flow.
 */
export async function awaitOAuthCallback(
  expectedState: string,
  timeoutMs = 5 * 60 * 1000,
): Promise<AuthToken> {
  // The Rust side emits `oauth-callback` with just the bearer token +
  // matching state; the full AuthToken (expiresAt + roles + permissions)
  // only exists once we exchange the bearer with the auth server.
  // That exchange is what `auth_complete_oauth_token` does — it calls
  // `/api/launcher/user` with the bearer and reads back the canonical
  // user record.
  const bearer = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      unlistenPromise.then((fn) => fn()).catch(() => {})
      reject(new Error('OAuth timed out — please try again.'))
    }, timeoutMs)

    const unlistenPromise: Promise<UnlistenFn> = listen<{
      token?: string
      state?: string
      error?: string
    }>('oauth-callback', (event) => {
      const payload = event.payload
      if (payload?.state !== expectedState) return
      clearTimeout(timer)
      unlistenPromise.then((fn) => fn()).catch(() => {})
      if (payload.error) {
        reject(new Error(payload.error))
        return
      }
      if (!payload.token) {
        reject(new Error('OAuth callback missing token'))
        return
      }
      resolve(payload.token)
    })
  })

  // Bearer → full AuthToken. Doing the exchange on the Rust side keeps
  // the `Authorization: Bearer …` header off the renderer's HTTP stack
  // and gives us a single place to handle server errors / retries.
  const isDevRuntime = import.meta.env.DEV
  const token = await invoke<AuthToken>('auth_complete_oauth_token', {
    token: bearer,
    isDevRuntime,
  })
  return token
}

/**
 * GET /api/launcher/oauth/introspect. Cheap "is this token still
 * valid?" check. Used at startup before showing the home screen.
 */
export async function introspectToken(
  token: string,
): Promise<IntrospectResponse> {
  const base = await getApiBaseUrl()
  const response = await fetch(`${base}/api/launcher/oauth/introspect`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return (await response.json()) as IntrospectResponse
}