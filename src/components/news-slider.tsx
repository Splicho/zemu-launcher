import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { A11y } from 'swiper/modules'
import { Swiper, SwiperSlide } from 'swiper/react'
import 'swiper/css'

import { fetchNewsList, formatNewsDate, type NewsListItem } from '@/lib/news'
import { useHashRouter } from '@/hooks/use-hash'
import { cn } from '@/lib/utils'

/**
 * Full-width news card. The cover image fills the entire card as a
 * background, with a dark gradient overlay on the left half so the
 * text stays readable regardless of the image. The title, excerpt,
 * date, and a "Read more" button sit on top of the image.
 *
 * The whole card is one clickable button — keyboard-focusable and
 * screen-reader navigable as a link thanks to the slide's a11y role.
 */
function NewsCard({ item }: { item: NewsListItem }) {
  const { navigate } = useHashRouter()

  return (
    <button
      type="button"
      onClick={() => navigate(`/news/${item.slug}`)}
      className="group relative flex h-80 w-full items-center overflow-hidden rounded-none"
    >
      {/* Full-cover background image */}
      <img
        src={item.coverImageUrl ?? ''}
        alt={item.coverImageAlt}
        loading="lazy"
        className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
      />

      {/* Gradient overlay — stronger on the left, fades to transparent */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to right, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.6) 50%, rgba(0,0,0,0) 100%)',
        }}
      />

      {/* Text content */}
      <div className="relative z-10 flex max-w-xl flex-col gap-3 px-12 py-8 text-left">
        <div className="flex items-center gap-2 text-xs text-white/60">
          <span className="uppercase tracking-wide">{item.category}</span>
          <span>·</span>
          <span>{formatNewsDate(item.publishedAt)}</span>
        </div>

        <h3 className="line-clamp-2 text-2xl font-bold leading-snug text-white">
          {item.title}
        </h3>

        <p className="line-clamp-2 text-sm text-white/75">{item.excerpt}</p>

        <div className="mt-1 flex items-center gap-1.5 text-sm font-medium text-white/80 transition-colors group-hover:text-white">
          <span>Read more</span>
          <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </button>
  )
}

/**
 * News slider for the home page.
 *
 * Fetches the latest posts from the public news API and renders them
 * as a horizontally swipeable full-width carousel. Each slide is a
 * full-cover card — no borders, no grid — with the title and excerpt
 * overlaid on the image. Clicking a card navigates to `#/news/:slug`.
 *
 * The slider shows one card at a time on all viewports. Navigation
 * arrows and dots can be added if needed — remove the `a11y` module
 * and add `Navigation` + `Pagination` back once that decision is made.
 */
export function NewsSlider() {
  const [items, setItems] = useState<NewsListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchNewsList()
      .then((list) => {
        if (!cancelled) setItems(list)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load news')
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return null
  }

  if (items === null || items.length === 0) {
    return null
  }

  return (
    <Swiper
      modules={[A11y]}
      slidesPerView={1}
      a11y={{ slideRole: 'link' }}
      className="news-slider"
    >
      {items.map((item) => (
        <SwiperSlide key={item.slug}>
          <NewsCard item={item} />
        </SwiperSlide>
      ))}
    </Swiper>
  )
}
