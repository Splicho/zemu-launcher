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
  type LeaderboardEntry,
  type LeaderboardSelection,
} from '@/lib/leaderboard'

/**
 * Full leaderboard entries with background auto-refresh every 60 seconds.
 *
 * "All modes" is the global season board, so its cache entry does not
 * depend on the selected region. Keying it separately avoids a
 * pointless refetch when the user flips EU ↔ NA.
 */
export function useLeaderboardEntries(
  initialEntries?: LeaderboardEntry[],
  selection: LeaderboardSelection = DEFAULT_LEADERBOARD_SELECTION,
) {
  const season = selection.teamMode === 'all'
  return useQuery({
    queryKey: [
      'leaderboard',
      'entries',
      season ? 'season' : selection.region,
      selection.teamMode,
    ],
    queryFn: () => fetchLeaderboardEntries(selection),
    // The preloaded entries are the season board, so they can seed
    // every "All modes" selection. A mode-specific view starts empty
    // instead of painting season rows under a Solo/Duo/Fives label.
    initialData: season ? initialEntries : undefined,
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
