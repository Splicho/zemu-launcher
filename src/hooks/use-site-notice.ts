import { useQuery } from '@tanstack/react-query'

import { fetchSiteNotice, type SiteNotice } from '@/lib/site-notice'

/**
 * `useSiteNotice` — the launcher's live notice for its own surface.
 *
 * Why a query hook rather than a bare `useEffect` fetch in the bar:
 *   - the key `['site-notice', 'launcher']` means the notice is
 *     fetched exactly once per app session no matter how many
 *     components read it, and
 *   - the `null`-on-failure contract of `fetchSiteNotice` is what
 *     keeps this safe to mount unconditionally at the top of the
 *     shell. There is no `isError` state to handle — a failed read
 *     is just "no bar today".
 *
 * Polling: a notice going live is an admin action, and the launcher
 * is a long-lived process, so a stale bar would be a bar that lies.
 * 5 minutes matches the query client's default `staleTime` and is
 * frequent enough that an admin who clicks "Go live" sees it within
 * one coffee break, while costing a single tiny GET per window. A
 * `visibilitychange`-driven refetch is deliberately NOT added — the
 * poll already covers a backgrounded window, and the transport is
 * free of CORS concerns so there is nothing to gain.
 *
 * `retry: 1` rather than the client default of 2: a second identical
 * attempt against a down api only delays the first paint of a shell
 * that does not need the bar.
 */
export function useSiteNotice() {
  const query = useQuery({
    queryKey: ['site-notice', 'launcher'],
    queryFn: fetchSiteNotice,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
  })

  return {
    ...query,
    /** The live notice, or `null` while loading / on failure / when nothing is live. */
    notice: (query.data as SiteNotice | null | undefined) ?? null,
  }
}
