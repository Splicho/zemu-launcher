import { Suspense } from 'react'

import { LeaderboardBanner } from '@/components/leaderboard/leaderboard-banner'
import LeaderboardTableWrapper from '@/components/leaderboard/leaderboard-table-wrapper'
import LeaderboardSkeleton from '@/components/leaderboard/leaderboard-skeleton'

/**
 * Leaderboard page — mounted at `#/leaderboard`.
 *
 * Everything lives inside one padded content column (`px-8`), so the
 * branded banner lines up with the filter bar and the table underneath it
 * instead of spanning the window edge-to-edge. The banner carries the page
 * title, so there is no second heading block.
 *
 * The page deliberately has **no scroll container of its own**: the route
 * area in `MainLayout` already scrolls, and nesting a second `overflow-y`
 * here produced two bars (plus a width mismatch, because the inner bar
 * narrowed the table while the banner kept the full column width).
 */
export function LeaderboardPage() {
  return (
    <div className="flex flex-col gap-6 px-8 pt-6 pb-8">
      <LeaderboardBanner className="rounded-xl" />

      <Suspense fallback={<LeaderboardSkeleton />}>
        <LeaderboardTableWrapper />
      </Suspense>
    </div>
  )
}
