import { NewsSlider } from '@/components/news-slider'
import { LeaderboardCard } from '@/components/leaderboard-card'
import { useHash } from '@/hooks/use-hash'
import { NewsPage } from '@/pages/news'
import { NewsSlugPage } from '@/pages/news-slug'

/**
 * Home / launcher content.
 *
 * Rendered inside `<MainLayout>` (title bar + sidebar + header) and
 * routed via the hash:
 *   - `#/`                 → default home content (news slider + leaderboard)
 *   - `#/news`             → full news grid (NewsPage)
 *   - `#/news/:slug`       → single post (NewsSlugPage)
 *
 * Chrome (sidebar, title bar, header) lives in the layout — pages
 * only own their own content.
 */
export function HomePage() {
  const hash = useHash()

  if (hash && hash.startsWith('/news/')) {
    const slug = hash.slice('/news/'.length)
    if (slug) return <NewsSlugPage slug={slug} />
  }

  if (hash === '/news') return <NewsPage />

  return (
    <div className="flex flex-col gap-6 px-8 py-6">
      <NewsSlider />
      <LeaderboardCard />
    </div>
  )
}