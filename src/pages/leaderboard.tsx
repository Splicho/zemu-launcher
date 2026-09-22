import { Suspense } from 'react'
import SeasonBanner from '@/components/leaderboard/season-banner'
import LeaderboardTableWrapper from '@/components/leaderboard/leaderboard-table-wrapper'
import LeaderboardSkeleton from '@/components/leaderboard/leaderboard-skeleton'

export function LeaderboardPage() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Season banner — full-bleed hero image at the top */}
      <SeasonBanner />

      {/* Scrollable content below the banner */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-6 pb-8 pt-6">
        <Suspense fallback={<LeaderboardSkeleton />}>
          <LeaderboardTableWrapper />
        </Suspense>
      </div>
    </div>
  )
}
