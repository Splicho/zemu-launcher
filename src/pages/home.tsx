import { NewsSlider } from '@/components/new-launcher'
import { SlayersOfTheWeek } from '@/components/new-launcher/slayers-of-the-week'
import { UpcomingEvents } from '@/components/new-launcher/upcoming-events'

/**
 * Home / launcher content.
 *
 * Rendered inside `<MainLayout>` (window bar + navbar + page content).
 * Route handling (news, news-slug) is handled in `main-app.tsx`.
 *
 * Layout, top to bottom: the news slider, then two equal columns —
 * the events calendar (left) and the weekly kill board (right). Both
 * fetch public API endpoints and degrade to their own empty state, so
 * the page never blocks on either.
 */
export function HomePage() {
  return (
    // `px-6` is the card's outside inset, `pt-8` pushes it clear of the
    // navbar strip, `gap-6` spaces the sections.
    <div className="flex flex-1 flex-col gap-6 px-6 pt-8 pb-6">
      <NewsSlider />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <UpcomingEvents />
        <SlayersOfTheWeek />
      </div>
    </div>
  )
}
