import { useQuery } from '@tanstack/react-query'
import { fetchStreams } from '@/api/streams'

/**
 * Lightweight hook used by UI chrome (sidebar, friends sheet, etc.)
 * that only cares about *whether* anyone is live right now and roughly
 * how many. It reuses the same `/streams` endpoint and 60s refetch
 * cadence the page-level grids use, so we don't hammer the API with
 * a second poll. The result is intentionally not deduped against the
 * per-page query — React Query collapses identical `queryKey`s, so
 * mounting this hook alongside the streams page produces one fetch,
 * not two.
 */
export function useLiveStreams() {
  const query = useQuery({
    queryKey: ['streams'],
    queryFn: fetchStreams,
    refetchInterval: 60000,
  })

  const twitch = query.data?.twitch ?? []
  const kick = query.data?.kick ?? []
  const liveCount = twitch.length + kick.length

  return {
    ...query,
    liveCount,
    twitchCount: twitch.length,
    kickCount: kick.length,
  }
}
