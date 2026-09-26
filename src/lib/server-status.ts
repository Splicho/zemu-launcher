/**
 * Server status — a single-region player-count probe against the
 * api's `GET /v1/playercount` endpoint.
 *
 * The endpoint is gated by `InternalApiGuard`, so the launcher
 * sends `Authorization: Bearer <API_INTERNAL_KEY>`. Today there is
 * only one region (EU); the dropdown UI keeps a `servers` array so
 * additional regions can be slotted in without changing the rest
 * of the pipeline.
 *
 * Response shape mirrors
 * `apps/api/src/playercount/playercount.service.ts`
 * `PlayerCountResponse`:
 *
 *   {
 *     ok: boolean,
 *     total: number,
 *     lobby: number,
 *     inMatch: number,
 *     worlds: PlayerCountWorld[],
 *     updatedAt: number,
 *     fetchedAt: string,
 *     source: 'live' | 'cache' | 'unavailable'
 *   }
 *
 * When the upstream is down the service returns `ok: false` with
 * `source: 'cache' | 'unavailable'`. The launcher treats both as
 * "we don't have a number right now" and renders the region
 * accordingly — never crashes the dropdown over a transient
 * upstream blip.
 */

import { LAUNCHER_CONFIG } from '@/config/launcher'
import { fetchInternalApi } from '@/lib/internal-api'

export type PlayerCountSource = 'live' | 'cache' | 'unavailable'

export interface PlayerCountWorld {
  name?: string
  players?: number
  instances?: number
  inProgress?: number
}

export interface PlayerCount {
  ok: boolean
  total: number
  lobby: number
  inMatch: number
  worlds: PlayerCountWorld[]
  updatedAt: number
  fetchedAt: string
  source: PlayerCountSource
}

/**
 * The single supported region for now. EU first per the design
 * call; NA + APAC slots stay empty until the URLs + display labels
 * are wired up. Keep this list in display order so the dropdown
 * renders EU at the top and additional regions underneath.
 */
export interface ServerRegion {
  /** Stable id used as the React key + the dropdown row key. */
  id: 'eu' | 'na' | 'apac'
  /** Display label rendered in the dropdown (e.g. "Europe"). */
  label: string
  /** Game-server host:port shown on the row (e.g. "eu.zemu.uk:1115"). */
  gameServer: string
  /**
   * Resolved playercount endpoint URL. `null` means the region is
   * declared but not yet wired to a probe endpoint — the dropdown
   * renders the row but skips the count fetch.
   */
  playercountUrl: string | null
}

export const SERVERS: readonly ServerRegion[] = [
  {
    id: 'eu',
    label: 'Europe',
    gameServer: 'eu.zemu.uk:1115',
    playercountUrl: getInternalPlayercountUrl(),
  },
]

function getInternalPlayercountUrl(): string {
  const fromEnv = import.meta.env.VITE_LAUNCHER_INTERNAL_PLAYERCOUNT_URL as
    | string
    | undefined
  if (import.meta.env.DEV && fromEnv && fromEnv.length > 0) {
    return fromEnv
  }
  return LAUNCHER_CONFIG.internalPlayercountUrl
}

/**
 * Returns the empty string when the key isn't configured. Callers
 * use the empty string as the signal to skip the fetch (rather than
 * sending `Bearer ` with no value, which would 401 from the api).
 *
 * Dev: read from `.env.local`'s `VITE_LAUNCHER_INTERNAL_API_KEY`.
 * Prod: read from the build-time env (`vite build` inlines
 * `import.meta.env.VITE_*` at compile time). An unset env means
 * the launcher was built without the key — the dropdown renders a
 * "not configured" state instead of failing silently.
 */
export function getInternalApiKey(): string {
  const raw = import.meta.env.VITE_LAUNCHER_INTERNAL_API_KEY as
    | string
    | undefined
  if (typeof raw === 'string') return raw.trim()
  return ''
}

export async function fetchPlayerCount(
  url: string,
): Promise<PlayerCount | null> {
  const key = getInternalApiKey()
  if (key.length === 0) return null
  const res = await fetchInternalApi(url, key)
  if (!res.ok) return null
  const data = (await res.json()) as Partial<PlayerCount>
  return normalisePlayerCount(data)
}

function normalisePlayerCount(data: Partial<PlayerCount>): PlayerCount | null {
  if (!data || typeof data !== 'object') return null
  return {
    ok: data.ok === true,
    total: typeof data.total === 'number' ? data.total : 0,
    lobby: typeof data.lobby === 'number' ? data.lobby : 0,
    inMatch: typeof data.inMatch === 'number' ? data.inMatch : 0,
    worlds: Array.isArray(data.worlds)
      ? (data.worlds as PlayerCountWorld[])
      : [],
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
    fetchedAt:
      typeof data.fetchedAt === 'string' ? data.fetchedAt : new Date().toISOString(),
    source:
      data.source === 'live' || data.source === 'cache'
        ? data.source
        : 'unavailable',
  }
}
