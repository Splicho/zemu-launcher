import { NewsSlider } from '@/components/news-slider'
import { LeaderboardCard } from '@/components/leaderboard-card'

/**
 * Home / launcher content.
 *
 * Rendered inside `<MainLayout>` (title bar + sidebar + header).
 * Route handling (news, news-slug) is handled in App.tsx.
 */
export function HomePage() {
  return (
    <div className="flex flex-col gap-6 py-6">
      <NewsSlider />
      <LeaderboardCard />
    </div>
  )
}