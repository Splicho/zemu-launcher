/**
 * API contract for `GET /v1/playercount` — the launcher's source of
 * truth for "how many people are online right now".
 *
 * The endpoint returns a single payload per region — NOT one entry
 * per server — so the page has to map regions to sub-fields rather
 * than iterating an array. Today the bar just renders `total` against
 * the visual `MAX_PLAYERS` cap; `lobby` / `inMatch` are surfaced
 * later if the design wants a richer read-out.
 *
 * Auth:
 *   The api gates this route with `LauncherOrInternalGuard`, which
 *   accepts either a launcher JWT (verified by
 *   `LauncherBearerGuard`) or the shared `API_INTERNAL_KEY` (for the
 *   discord bots). We send the launcher's own bearer token so no
 *   shared secret is baked into the renderer bundle.
 *
 * Failure posture:
 *   - Transport errors → thrown, the hook renders an "offline" pill.
 *   - Non-200 → thrown, same fallback.
 *   - Malformed JSON → thrown, same fallback.
 *   The hook catches all three and projects them to `{ ok: false }`
 *   so the page never has to `try/catch`.
 *
 * Why a hand-rolled fetcher (not `fetch`):
 *   `httpFetch` is the shared Tauri-aware transport, identical to the
 *   one the heartbeat hook uses. Reusing it means we get Rust-side
 *   networking on desktop for free and stay consistent with the rest
 *   of the launcher.
 */

import { httpFetch } from '@/lib/http-fetch'
import { readPersistedToken } from '@/lib/auth'
import { LAUNCHER_CONFIG } from '@/config/launcher'

export interface PlayerCountWorld {
  name: string
  players: number
  instances: number
  inProgress: number
}

export interface PlayerCount {
  /** Total humans across lobby + in-match. What the progress bar reads. */
  total: number
  /** Humans currently sitting in the lobby. */
  lobby: number
  /** Humans currently inside a live match. */
  inMatch: number
  /** Per-mode breakdown. Optional in the api response. */
  worlds?: ReadonlyArray<PlayerCountWorld>
  /** Server-side timestamp (unix seconds). Used for stale detection. */
  updatedAt: number
}

export interface PlayerCountResult {
  ok: boolean
  data?: PlayerCount
  error?: string
}

/** Resolve the api base URL the same way the heartbeat hook does —
 *  env override in dev, the public launcher's configured URL otherwise.
 *  Keeping the resolution in one helper means the dev/test/prod switch
 *  stays consistent across the renderer. */
function resolveApiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_URL as string | undefined
  if (import.meta.env.DEV && fromEnv) return fromEnv
  return LAUNCHER_CONFIG.friendsApiBaseUrl
}

/**
 * Fetch the live player count. The api returns a single global
 * payload (one region today — EU) — region is a hook-time concern
 * (cache key, polling), not a URL concern.
 *
 * Note: `httpFetch` doesn't forward `AbortSignal` (it goes through
 * the Tauri IPC bridge on desktop and a plain `fetch` on web).
 * TanStack Query retries are bounded (`retry: 1` in the hook) and
 * `refetchInterval` ticks are also cancelled when the component
 * unmounts, so the lack of in-flight cancellation isn't a leak in
 * practice — a stale request finishes and is discarded by the
 * `enabled` guard.
 *
 * Never throws — failures are projected to `{ ok: false, error }`
 * so consumers just check the boolean.
 */
export async function fetchPlayerCount(): Promise<PlayerCountResult> {
  const base = resolveApiBaseUrl().replace(/\/+$/, '')
  const url = `${base}/v1/playercount`
  // The api's `/v1/playercount` accepts either the launcher's
  // session JWT or the shared internal key (`LauncherOrInternalGuard`).
  // We send the launcher's JWT when one is persisted — same
  // pattern as the heartbeat hook — so the call is authenticated
  // without baking any shared secret into the renderer bundle.
  // A missing / cleared token (logged-out state) is fine: the hook
  // exposes `ok: false` and the page falls back to the em-dash
  // "offline" pill until the user signs in.
  const token = readPersistedToken()?.token ?? null
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  try {
    const res = await httpFetch(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
    })
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} ${res.statusText}` }
    }
    const data = (await res.json()) as PlayerCount
    return { ok: true, data }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}