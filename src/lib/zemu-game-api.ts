/**
 * Shared HTTP shim for the game server's HTTP API.
 *
 * Base URL: `http://217.160.250.198:8126` (plain HTTP — see the
 * `LAUNCHER-API` doc, point 2). The server speaks the same JSON
 * envelope the launcher's `FriendsGraph` and `PartyState` describe,
 * and exposes the friends + party + avatar endpoints on top of that.
 *
 * Auth model:
 *   - The server identifies the caller via `Authorization: Bearer
 *     <ZEmu auth key>` — the same 0x + 16 hex-digit key the launcher
 *     already hands the game at launch time, persisted on disk by
 *     the Rust side. It is NOT the OAuth JWT the website uses; the
 *     game server knows nothing about `id.zemu.uk`. We pull it via
 *     `window.launcherAPI.getAuthKey()` rather than from localStorage.
 *   - `?key=` is accepted too, but the renderer always uses the
 *     header so the key never appears in proxy / browser logs.
 *
 * No realtime push: this server has no Socket.IO. Friends + party
 * callers poll and rely on `If-None-Match` / `ETag` for cheap no-op
 * rounds (see `FriendsGraph` polling in `friends.ts`).
 *
 * Error model (per the LAUNCHER-API doc, "Errors and troubleshooting"):
 *   - 2xx with `{ ok: false, reason }` — caller-facing refusal. We
 *     forward the body verbatim to the caller's normalizer.
 *   - 401 / 400 / 404 / 405 → `{ error }`. We surface the
 *     `error` message as a thrown `Error` so 401s can short-circuit
 *     auth gating (no signed-in user, no character, unknown key).
 *   - 429 → "rate limited". Per-IP 300 req/min; the friends +
 *     party pollers stay well below this.
 *   - fetch throw → TypeError. Caller maps to a generic reason.
 *
 * Logging: every request writes a one-line entry to the launcher's
 * `friendlist-debug.log` via the same `friends_debug_log_write`
 * command the old `src/lib/friends.ts` used. Network errors and
 * unusual status codes get a verbose entry; success cases get a
 * short status+ms line. Set `silent: true` for high-volume callers
 * (the friends 304 path) to avoid spamming the log.
 */
import { invoke, isTauri } from '@tauri-apps/api/core'

// Per the LAUNCHER-API doc, the game server is `http://217.160.250.198:8126`.
// Kept as a single constant so a future env override (stage / tunnel) lands
// in one place. Plain HTTP is intentional — see the doc's caveat in point 2.
export const GAME_API_BASE_URL = 'http://217.160.250.198:8126'

/** Returns `null` when the user has not saved an auth key locally. */
export async function getZemuAuthKey(): Promise<string | null> {
  if (typeof window === 'undefined' || !window.launcherAPI?.getAuthKey) {
    return null
  }
  try {
    const value = await window.launcherAPI.getAuthKey()
    return typeof value === 'string' && value.length > 0 ? value : null
  } catch {
    return null
  }
}

/**
 * Best-effort write of one log line to `friendlist-debug.log`. Falls
 * back to `console.log` outside Tauri (browser dev, vite dev server)
 * so dev consoles keep working.
 *
 * Never throws — log writes never block the actual API call.
 */
async function gameDebugLog(
  source: string,
  message: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const content = metadata ? `${message} | ${safeStringify(metadata)}` : message
  if (!isTauri()) {
    console.log(`[friends] ${content}`)
    return
  }
  try {
    await invoke('friends_debug_log_write', {
      source,
      message: content,
    })
  } catch {
    // Best-effort.
  }
}

/**
 * Public friends debug logger. Exported so app-level code (e.g. the
 * `useAvatarSync` host) can write to the same `friendlist-debug.log`
 * file the `gameFetch` shim uses. Mirrors the original
 * `window.friendsDebugLog` global bridge (still wired in
 * `tauri-bridge.ts` for legacy `console.log`-style callers).
 */
export const friendsDebugLog = {
  log: gameDebugLog,
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export interface GameFetchOptions extends Omit<RequestInit, 'body'> {
  /** Pre-serialised JSON body. Strings / Blobs are forwarded verbatim. */
  body?: BodyInit | null
  /** When true, skip success-path logging. Failures still log. */
  silent?: boolean
  /**
   * Override the default bearer header. Default pulls the ZEmu auth
   * key via `getZemuAuthKey()`. Pass `null` for endpoints that don't
   * need auth (e.g. `GET /avatar/<id>`), or a literal string for
   * tests / impersonation.
   */
  bearer?: string | null
}

/**
 * Raw fetch wrapper. Returns the parsed JSON body. For refusal
 * bodies that still come back as 2xx (`{ ok: false, reason }`), the
 * caller is responsible for inspecting `ok` itself — we don't
 * throw on those, because the doc's "refusals are still HTTP 200"
 * rule means the caller can't reliably distinguish "transport
 * failure" from "API refusal" by status alone.
 *
 * Throws an `Error` for genuine transport / 4xx / 5xx failures. The
 * `GameApiError` shape carries the HTTP status and parsed body so
 * callers can branch on `401` vs `429` etc. without re-parsing
 * strings.
 */
export class GameApiError extends Error {
  readonly status: number
  readonly body: unknown
  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'GameApiError'
    this.status = status
    this.body = body
  }
}

/**
 * Coarse taxonomy of game-server 401 bodies. The server returns 401
 * for four distinct conditions, only one of which means the caller
 * is unauthenticated in the OAuth sense — see LAUNCHER-API (1).md
 * "Before you start" (point 4) and the "Errors and troubleshooting"
 * table near the bottom:
 *
 *   - `key=<auth key> (or Authorization: Bearer) or characterId is required`
 *       The header didn't arrive. Real client-side bug.
 *   - `unknown key - the account has not logged into the game yet`
 *       The key is well-formed but the game has never used it, so
 *       no row exists server-side. User remediation: launch the
 *       game once with the key.
 *   - `that account has no character yet`
 *       Player has signed in but not picked a character in-game
 *       yet. User remediation: create a character in-game.
 *   - `characterId is not a character of that account`
 *       Bad `?characterId=` on the request (we never pass one, so
 *       we treat it the same as the no-character case).
 *
 * The server's `error` field is a plain string for 401s, so we
 * match on substrings rather than parsing JSON. `key_never_played`
 * and `no_character` are the two the user can actually do something
 * about; `missing_auth_header` points at our own code.
 */
export type GameApiAuthReason =
  | 'missing_auth_header'
  | 'key_never_played'
  | 'no_character'
  | 'unauthenticated'

function readServerError(body: unknown): string {
  if (body && typeof body === 'object') {
    const err = (body as { error?: unknown }).error
    if (typeof err === 'string') return err
  }
  return ''
}

/**
 * Maps a thrown `GameApiError` (status === 401) into one of the
 * reasons above, or `null` if the status isn't 401. Caller-facing
 * `reason` strings are translated to localized copy by the panel.
 */
export function mapGameApiAuthReason(error: GameApiError): GameApiAuthReason {
  if (error.status !== 401) return 'unauthenticated'
  const message = readServerError(error.body).toLowerCase()
  if (!message) return 'unauthenticated'
  if (message.includes('has not logged into the game')) return 'key_never_played'
  if (message.includes('no character')) return 'no_character'
  if (message.includes('is required')) return 'missing_auth_header'
  return 'unauthenticated'
}

export async function gameFetch<T = unknown>(
  path: string,
  options: GameFetchOptions = {},
): Promise<T> {
  const url = `${GAME_API_BASE_URL}${path}`
  const { body, silent, bearer, headers: rawHeaders, ...rest } = options
  const headers = new Headers(rawHeaders)
  const method = (rest.method ?? (body ? 'POST' : 'GET')).toUpperCase()

  const resolvedBearer =
    bearer === undefined ? await getZemuAuthKey() : bearer
  if (resolvedBearer) {
    headers.set('Authorization', `Bearer ${resolvedBearer}`)
  }
  // Skip Accept negotiation — server always returns JSON for the
  // /api/* endpoints, raw bytes for /avatar/* and /upload. The
  // caller has to set its own Content-Type when uploading bytes
  // (see `avatar.ts`).

  const startedAt = performance.now()
  if (!silent) {
    console.log(`[game] → ${method} ${path}`)
    await gameDebugLog(
      'http',
      `→ ${method} ${path}`,
      resolvedBearer ? { bearer: 'yes' } : { bearer: 'no' },
    )
  }

  let response: Response
  try {
    response = await fetch(url, {
      ...rest,
      method,
      headers,
      body,
    })
  } catch (networkError) {
    const message =
      networkError instanceof Error
        ? networkError.message
        : String(networkError)
    console.error(`[game] fetch threw for ${method} ${path}`, networkError)
    await gameDebugLog('http', `× ${method} ${path}`, {
      network_error: true,
      message,
    })
    throw networkError instanceof Error
      ? networkError
      : new Error(message)
  }

  const elapsed = Math.round(performance.now() - startedAt)
  const text = await response.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }

  if (!silent || !response.ok) {
    console.log(
      `[game] ← ${response.status} ${method} ${path} (${elapsed}ms)`,
    )
    await gameDebugLog(
      'http',
      `← ${response.status} ${method} ${path} (${elapsed}ms)`,
    )
  }

  if (!response.ok) {
    const errorMessage =
      payload && typeof payload === 'object'
        ? String((payload as { error?: unknown }).error ?? '')
        : text || `HTTP ${response.status}`
    await gameDebugLog('http', `✗ HTTP ${response.status} ${method} ${path}`, {
      message: errorMessage,
    })
    throw new GameApiError(errorMessage, response.status, payload)
  }

  return payload as T
}

/**
 * Helper for the 304 short-circuit. Returns the parsed body on a 200,
 * `null` on a 304 with no body. Throws on anything else (the
 * underlying `gameFetch` already handles non-2xx). The caller is
 * responsible for reading the ETag from `response.headers.get('etag')`
 * via the version that takes an explicit `Request` callback.
 */
export async function gameFetchWithEtag<T = unknown>(
  path: string,
  ifNoneMatch: string | null,
): Promise<{ graph: T | null; etag: string | null }> {
  const url = `${GAME_API_BASE_URL}${path}`
  const headers = new Headers()
  const bearer = await getZemuAuthKey()
  if (bearer) headers.set('Authorization', `Bearer ${bearer}`)
  if (ifNoneMatch) headers.set('If-None-Match', ifNoneMatch)

  const startedAt = performance.now()
  try {
    const response = await fetch(url, { method: 'GET', headers })
    const elapsed = Math.round(performance.now() - startedAt)
    const etag = response.headers.get('etag')
    if (response.status === 304) {
      console.log(`[game] ← 304 ${path} (${elapsed}ms, etag matched)`)
      await gameDebugLog(
        'http',
        `← 304 ${path} (${elapsed}ms, etag matched)`,
      )
      return { graph: null, etag }
    }
    if (!response.ok) {
      const text = await response.text()
      const payload = text
        ? (() => {
            try {
              return JSON.parse(text)
            } catch {
              return text
            }
          })()
        : null
      const errorMessage =
        payload && typeof payload === 'object'
          ? String((payload as { error?: unknown }).error ?? '')
          : text || `HTTP ${response.status}`
      await gameDebugLog('http', `✗ HTTP ${response.status} ${path}`, {
        message: errorMessage,
      })
      throw new GameApiError(errorMessage, response.status, payload)
    }
    const payload = (await response.json()) as T
    console.log(`[game] ← ${response.status} ${path} (${elapsed}ms)`)
    await gameDebugLog('http', `← ${response.status} ${path} (${elapsed}ms)`, {
      etag,
    })
    return { graph: payload, etag }
  } catch (networkError) {
    if (networkError instanceof GameApiError) throw networkError
    const message =
      networkError instanceof Error
        ? networkError.message
        : String(networkError)
    await gameDebugLog('http', `× ${path}`, {
      network_error: true,
      message,
    })
    throw networkError instanceof Error
      ? networkError
      : new Error(message)
  }
}
