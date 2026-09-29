/**
 * `usePlayerCount` — TanStack Query wrapper around `fetchPlayerCount`.
 *
 * The api exposes a single global endpoint today (EU only), so this
 * hook returns a shared `total` and consumers just read it. The
 * `regionId` parameter only affects the query key + whether polling
 * runs — once NA/APAC ship, each region will get its own endpoint
 * and this hook is the one place we add per-region routing.
 *
 * Query key:
 *   `['playercount', regionId]` — the `regionId` segment is
 *   forward-compatible: when each region gets its own endpoint we
 *   swap the fetcher's URL but keep the key, so any cached data
 *   stays grouped under its region in devtools.
 *
 * Polling:
 *   30s by default. Matches the heartbeat interval so the bar's
 *   freshness signal tracks the rest of the launcher's realtime
 *   story (the api's heartbeat staleness window is 90s; 30s is
 *   well under that).
 *
 * State surface (the page only cares about three of these):
 *   - `disabled`  → region not wired up yet (NA/APAC today).
 *                   Distinct from `isError` so the page can render
 *                   a "coming soon" pill instead of a hard N/A.
 *   - `isPending` → first load, no cached data yet.
 *   - `isError`   → api call failed (network / non-2xx / bad JSON).
 *   - otherwise   → `total` is set.
 *
 * The hook never throws; TanStack Query itself catches and exposes
 * errors via `error` / `isError`.
 */

import { useQuery } from '@tanstack/react-query'

import { readPersistedToken } from '@/lib/auth'
import {
  fetchPlayerCount,
  type PlayerCount,
  type PlayerCountResult,
} from '@/lib/playercount'

/** Poll cadence for the player-count probe. Mirrors the heartbeat's
 *  30s tick so a user's "Online" badge and the bar's fill age in
 *  lockstep — visually, they're the same heartbeat signal. */
const PLAYERCOUNT_POLL_MS = 30_000

/** `staleTime` matches the poll interval — the next tick is what
 *  invalidates the cache, not a stale-after threshold. */
const PLAYERCOUNT_STALE_MS = PLAYERCOUNT_POLL_MS

export function playerCountKeys() {
  return {
    all: ['playercount'] as const,
    byRegion: (regionId: 'eu' | 'na' | 'apac' | null) =>
      ['playercount', regionId ?? 'disabled'] as const,
  }
}

interface UsePlayerCountResult {
  /** Live total from the api. `undefined` while loading, after an
   *  error, or while the probe is disabled. */
  total: number | undefined
  /** True on the very first load (no cached data yet). */
  isPending: boolean
  /** True after at least one failed fetch. */
  isError: boolean
  /** True when the caller passed `null` (probe intentionally off —
   *  region not yet wired up). Distinct from `isError` so callers
   *  can render "coming soon" instead of "N/A". */
  disabled: boolean
  /** Human-readable error string, if any. */
  error: string | undefined
  /** Server-side `updatedAt` epoch, in seconds. `undefined` until loaded. */
  updatedAt: number | undefined
}

/**
 * Subscribe to the live player count.
 *
 * @param regionId - the `ServerRegion.id` to scope the cache to.
 *   Today this doesn't change the URL (single global endpoint),
 *   but it's kept in the key so per-region caching is automatic
 *   when NA/APAC ship. Pass `null` to disable the probe.
 */
export function usePlayerCount(
  regionId: 'eu' | 'na' | 'apac' | null,
): UsePlayerCountResult {
  // `enabled: regionId !== null` keeps the query entry alive (so the
  // hook is always called and React's rules-of-hooks stays happy),
  // but suppresses fetches, polling and the pending state when the
  // caller passed `null`. The `disabled` projection below lets the
  // page tell the difference between "not wired up" and "api down".
  //
  // We also gate on a persisted token — the api requires auth, and
  // a logged-out user polling every 30s would just churn 401s and
  // log noise. The presence-heartbeat hook follows the same rule
  // (no token → no fetch), so this is a consistent posture across
  // realtime probes.
  const hasToken = readPersistedToken()?.token != null
  const enabled = regionId !== null && hasToken
  const query = useQuery<PlayerCountResult, Error>({
    queryKey: playerCountKeys().byRegion(regionId),
    queryFn: () => fetchPlayerCount(),
    enabled,
    refetchInterval: PLAYERCOUNT_POLL_MS,
    staleTime: PLAYERCOUNT_STALE_MS,
    // Background tabs shouldn't burn battery probing the api. The
    // other realtime hooks (`usePresenceHeartbeat`, friends socket)
    // pause on tab-hide too; consistent posture here.
    refetchIntervalInBackground: false,
    retry: 1,
  })

  const disabled = regionId === null
  // Logged-out users have no token to send, so the probe is
  // effectively off (the api would 401 every poll). Surface that
  // as the offline pill (`isError: true`, no `total`) rather than
  // a perpetual skeleton. The page already maps `isError` to the
  // offline state, so we don't need a new variant in the page.
  const authedOff = !disabled && !hasToken

  // When the probe is disabled there's no `data` and `isPending` is
  // technically false (no fetch was ever started) — but TanStack
  // Query's default state with `enabled: false` is `fetchStatus:
  // 'idle'` and `status: 'pending'`. Override so the page sees a
  // clean "disabled" surface instead of a perpetual skeleton.
  const result = query.data
  const total = result?.ok ? (result.data as PlayerCount).total : undefined
  const updatedAt = result?.ok
    ? (result.data as PlayerCount).updatedAt
    : undefined

  return {
    total,
    isPending: disabled || authedOff ? false : query.isPending,
    isError:
      disabled
        ? false
        : authedOff
          ? true
          : query.isError || (result?.ok === false),
    disabled,
    error:
      disabled
        ? undefined
        : authedOff
          ? 'Not signed in'
          : query.error?.message ?? result?.error,
    updatedAt,
  }
}