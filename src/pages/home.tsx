import { NewsSlider } from '@/components/news-slider'
import { LeaderboardCard } from '@/components/leaderboard-card'

/**
 * Home / launcher content.
 *
 * Rendered inside `<MainLayout>`. The news hero
 * runs edge to edge — `-mx-6 sm:-mx-8` cancels <main>'s horizontal
 * padding — and the top-5 leaderboard sits below it, re-padded.
 * Route handling (news, news-slug) is handled in App.tsx.
 */
export function HomePage() {
  return (
    <div className="-mx-6 flex flex-col gap-8 pb-8 sm:-mx-8">
      <NewsSlider />
      <div className="px-6 sm:px-8">
        <LeaderboardCard />
      </div>
    </div>
  )
}
