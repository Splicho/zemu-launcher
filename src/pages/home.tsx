import { NewsSlider } from '@/components/new-launcher'

/**
 * Home / launcher content.
 *
 * Rendered inside `<MainLayout>` (window bar + navbar + page content).
 * Route handling (news, news-slug) is handled in `main-app.tsx`.
 *
 * UI REWORK: the old sections (`NewsSlider`, `LeaderboardCard`) are
 * replaced by the new launcher components one at a time — the news
 * slider is first, directly under the navbar. The account menu moved
 * out of this page and into the navbar's right column.
 */
export function HomePage() {
  return (
    // `px-6` is the card's outside inset, `pt-8` pushes it clear of the
    // navbar strip, `gap-6` spaces the sections that will follow.
    <div className="flex flex-1 flex-col gap-6 px-6 pt-8 pb-6">
      <NewsSlider />
    </div>
  )
}
