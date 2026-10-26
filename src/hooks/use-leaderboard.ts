/**
 * TanStack Query hooks for the leaderboard page.
 *
 * Mirrors the query setup in `apps/leaderboard/lib/use-leaderboard-query.ts`
 * but adapted for the launcher's Vite/React stack.
 */

import { useQuery } from '@tanstack/react-query'
import {
  DEFAULT_LEADERBOARD_SELECTION,
  fetchLeaderboardEntries,
  fetchClantags,
  type LeaderboardSelection,
} from '@/lib/leaderboard'

/**
 * Full leaderboard entries with background auto-refresh every 60 seconds.
 *
 * The cache is keyed by the selected region/mode.
 */
export function useLeaderboardEntries(
  selection: LeaderboardSelection = DEFAULT_LEADERBOARD_SELECTION,
) {
  return useQuery({
    queryKey: ['leaderboard', 'entries', selection.region, selection.teamMode],
    queryFn: () => fetchLeaderboardEntries(selection),
    staleTime: 20_000,
    gcTime: 60_000,
    retry: 1,
    networkMode: 'offlineFirst',
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
