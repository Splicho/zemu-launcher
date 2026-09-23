/**
 * TanStack Query hooks for the leaderboard page.
 *
 * Mirrors the query setup in `apps/leaderboard/lib/use-leaderboard-query.ts`
 * but adapted for the launcher's Vite/React stack.
 */

import { useQuery } from '@tanstack/react-query'
import {
  fetchLeaderboardEntries,
  fetchPlayerTopMatches,
  fetchClantags,
  type LeaderboardEntry,
} from '@/lib/leaderboard'

/**
 * Full leaderboard entries, kept fresh for 20 seconds between visits.
 * Only seed the cache when entries were actually preloaded. Defaulting to []
 * would mark an unfetched leaderboard as fresh and suppress the first request.
 */
export function useLeaderboardEntries(initialEntries?: LeaderboardEntry[]) {
  return useQuery({
    queryKey: ['leaderboard', 'entries'],
    queryFn: fetchLeaderboardEntries,
    initialData: initialEntries,
    staleTime: 20_000,
    gcTime: 60_000,
    retry: 1,
    networkMode: 'offlineFirst',
  })
}

/**
 * Per-player top-matches query.
 *
 * `enabled: false` means it never fires on its own — callers trigger it
 * manually via `refetch()`. Hover prefetch and click-to-expand both use
 * this same hook. The cache is keyed on the player name so expanding
 * Player A then Player B leaves A's matches cached.
 */
export function usePlayerTopMatches(playerName: string | null) {
  return useQuery({
    queryKey: ['player', 'topMatches', playerName],
    queryFn: () => fetchPlayerTopMatches(playerName ?? ''),
    enabled: false,
    staleTime: 60_000,
    retry: 1,
  })
}

/**
 * Batch clantag lookup for a set of display names.
 * Returns a `Map<nameLower, ClanTagEntry>`. Unmatched names are absent.
 */
export function useClantags(names: readonly string[]) {
  return useQuery({
    queryKey: ['clantags', names.join(',')],
    queryFn: () => fetchClantags(names),
    staleTime: 5 * 60_000,
    retry: 1,
  })
}
