import { useQuery } from '@tanstack/react-query'

import {
  fetchPlayerCount,
  getInternalApiKey,
  type PlayerCount,
  type ServerRegion,
} from '@/lib/server-status'

/**
 * Poll the api for the live playercount of a single server region.
 *
 * 30 s refetch matches the api's own 10 s server-side cache TTL
 * (PlayerCountService.CACHE_TTL_MS = 10_000) plus headroom — the
 * `live | cache | unavailable` source tag in the response carries
 * the freshness signal, so the UI can fade stale rows if it wants
 * to.
 *
 * `enabled` is `false` when either:
 *   - the region has no playercount probe URL (placeholder for a
 *     future region), or
 *   - the internal API key isn't configured (`VITE_LAUNCHER_INTERNAL_API_KEY`
 *     unset at build time / empty in `.env.local`).
 *
 * In both cases the query stays idle and the dropdown renders a
 * "not configured" state instead of firing a request that would
 * 401.
 */
export function useServerStatus(region: ServerRegion) {
  const hasKey = getInternalApiKey().length > 0
  const enabled = region.playercountUrl !== null && hasKey
  return useQuery<PlayerCount | null>({
    queryKey: ['server-status', region.id, region.playercountUrl ?? 'none'],
    enabled,
    refetchInterval: enabled ? 30_000 : false,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
    queryFn: async () => {
      if (!region.playercountUrl) return null
      return fetchPlayerCount(region.playercountUrl)
    },
  })
}
