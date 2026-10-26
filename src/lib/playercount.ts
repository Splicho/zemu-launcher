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
 * Region is a query parameter (`?region=eu|na`); no parameter is the
 * api's EU default. Each region has its own upstream and cache, so the
 * launcher must ask for the region it is about to render — a shared
 * "global" total would put the EU headcount under the Chicago heading.
 *
 * Auth:
 *   The api gates this route with `LauncherOrInternalGuard`, which
 *   accepts either a launcher JWT (verified by
 *   `LauncherBearerGuard`) or the shared `API_INTERNAL_KEY` (for the
 *   discord bots). We send the launcher's own bearer token so no
 *   shared secret is baked into the renderer bundle.
 *
 * Failure posture:
 *   - Transport errors → caught, `{ ok: false }`.
 *   - Non-200 → `{ ok: false }` with the HTTP status.
 *   - Malformed JSON → caught, `{ ok: false }`.
 *   - Region mismatch → `{ ok: false }`; never paint another region's
 *     number under this one.
 *   - `ok: false` / `source: "unavailable"` from the api → `{ ok:
 *     false }`, so the page shows "N/A" instead of a zero-filled bar.
 *   Consumers check the boolean; the page never has to `try/catch`.
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

/**
 * Regions the api's `/v1/playercount` understands. Kept in sync with
 * `PLAYERCOUNT_REGIONS` in `zemu-website/apps/api/src/playercount` —
 * a region the api doesn't know is a 400, not a silent zero.
 */
export type PlayerCountRegion = 'eu' | 'na'

/** Where the api got the reading from. `cache` is the api's own 30s
 *  grace window after an upstream hiccup; `unavailable` means it has
 *  no reading at all (upstream down or not configured). */
export type PlayerCountSource = 'live' | 'cache' | 'unavailable'

export interface PlayerCountWorld {
  name: string
  players: number
  instances: number
  inProgress: number
}

export interface PlayerCount {
  /** Which region's server answered. The api echoes the request's
   *  region so a misrouted poll is detectable. */
  region?: PlayerCountRegion
  /** `false` when the api has no reading for the region. Optional in
   *  the payload — an upstream that omits it is still reporting a
   *  real count. */
  ok?: boolean
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
  /** Provenance of the reading, see {@link PlayerCountSource}. */
  source?: PlayerCountSource
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
 * Fetch the live player count for one region.
 *
 * `region` is required: the api keeps a separate upstream and cache per
 * region, and defaulting here would hide a caller that forgot to say
 * which server it is drawing.
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
export async function fetchPlayerCount(
  region: PlayerCountRegion,
): Promise<PlayerCountResult> {
  const base = resolveApiBaseUrl().replace(/\/+$/, '')
  const url = `${base}/v1/playercount?region=${encodeURIComponent(region)}`
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

    // Region echo check. The api answers with the region it actually
    // drew from, so a response that doesn't match the request means
    // the number belongs to a different server.
    //
    // EU tolerates a *missing* echo: it is the api's default region,
    // so an older api that ignores `?region=` is still returning EU
    // data. NA does not — that api would be handing back the EU count,
    // and putting it under the Chicago heading is exactly the
    // confident-looking wrong number this guard exists to prevent.
    const echoed = data.region
    const echoTrustworthy =
      echoed === region || (echoed === undefined && region === 'eu')
    if (!echoTrustworthy) {
      return {
        ok: false,
        error: `Player count for "${region}" came back as "${echoed ?? 'unspecified region'}"`,
      }
    }

    // A 200 with `ok: false` (or `source: "unavailable"`) is the api
    // saying it has no reading — its upstream is down or not
    // configured. Rendering that as a zero-filled bar would advertise
    // an empty server, so project it to the error state instead.
    if (data.ok === false || data.source === 'unavailable') {
      return { ok: false, error: `No player count for "${region}"` }
    }

    return { ok: true, data }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}