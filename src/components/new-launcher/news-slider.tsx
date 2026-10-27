import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'

import { fetchNewsList, type NewsListItem } from '@/lib/news'
import { cn } from '@/lib/utils'

/**
 * News slider — new launcher UI.
 *
 * Sits directly under the navbar and spans the full content width: a
 * bordered panel with the article cover painted as the background and
 * the copy stacked on the left over a left-to-right scrim.
 *
 *   ┌───────────────────────────────────────────────┐
 *   │ CATEGORY • 14 SEPT 2026                       │
 *   │ NEWS TITLE                                    │
 *   │ Excerpt…                                      │
 *   │                                               │
 *   │ ▬▬ ▭ ▭                                        │
 *   └───────────────────────────────────────────────┘
 *
 * - The whole card is a link to `#/news/<slug>`: a stretched anchor
 *   sits above the copy (`z-10`) and the pill buttons sit above that
 *   (`z-20`), so the card is one big click target without nesting
 *   buttons inside an anchor.
 * - Pills use the dedicated assets in
 *   `public/btn/slider-navigation/` at their native 24×6. The active
 *   pill is the solid-red variant, the rest are the outlined variant.
 *   Each button is padded to a comfortable hit area without changing
 *   the rendered pill size.
 * - Slides cross-fade via framer-motion (already a dependency), and
 *   autoplay pauses while the pointer is over the card.
 *
 * Card geometry knobs live on the root: `h-80` is the height and
 * `rounded-xl` the corner radius. The outside inset is owned by the
 * page that renders it (see `pages/home.tsx`), not by this component.
 */

const AUTOPLAY_MS = 6000
const EASING = [0.25, 0.46, 0.45, 0.94] as const

const PILLS = {
  active: '/btn/slider-navigation/slider-nav-active.png',
  inactive: '/btn/slider-navigation/slider-nav-inactive.png',
} as const

/**
 * `14 SEPT 2026` — day first, month abbreviated and uppercased, as in
 * the design. Uses the runtime locale for the month name so the
 * launcher's other languages keep working.
 */
function formatCardDate(iso: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const month = date
    .toLocaleDateString(undefined, { month: 'short' })
    .replace('.', '')
    .toUpperCase()
  return `${date.getDate()} ${month} ${date.getFullYear()}`
}

function NewsSliderSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'h-80 w-full animate-pulse rounded-xl border border-border bg-muted/30',
        className,
      )}
      aria-hidden="true"
    />
  )
}

export function NewsSlider({ className }: { className?: string }) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  const { data: items, error } = useQuery({
    queryKey: ['news'],
    queryFn: fetchNewsList,
  })

  // Keep the index valid if the feed shrinks between refetches.
  const activeIndex = useMemo(() => {
    if (!items || items.length === 0) return 0
    return index % items.length
  }, [index, items])

  useEffect(() => {
    if (paused || !items || items.length <= 1) return
    // Re-created whenever the index changes, so a manual pill click
    // also restarts the timer instead of advancing a beat later.
    const id = window.setInterval(() => {
      setIndex((current) => (current + 1) % items.length)
    }, AUTOPLAY_MS)
    return () => window.clearInterval(id)
  }, [paused, items, activeIndex])

  if (error) return null
  if (!items) return <NewsSliderSkeleton className={className} />
  if (items.length === 0) return null

  const current: NewsListItem = items[activeIndex]
  const date = formatCardDate(current.publishedAt)
  const cover = current.coverImageUrl

  return (
    <div
      className={cn(
        'group relative h-80 w-full overflow-hidden rounded-xl border border-border bg-muted/20',
        className,
      )}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Cover — cross-fades between slides. */}
      <AnimatePresence initial={false}>
        <motion.div
          key={current.slug}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: EASING }}
        >
          {cover && (
            <img
              src={cover}
              alt={current.coverImageAlt}
              draggable={false}
              className="size-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Scrims: left-to-right for the copy, bottom-up for the pills. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/85 via-black/45 to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/60 to-transparent"
      />

      {/* Copy, left-aligned and vertically centred. No exit animation:
          the new copy mounts immediately so the title never lags behind
          the pills during a slide change. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 flex max-w-2xl flex-col justify-center px-8">
        <motion.div
          key={current.slug}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: EASING }}
        >
          <div className="flex items-center gap-2.5 text-[11px] font-medium uppercase tracking-[0.18em] text-white/60">
            <span>{current.category}</span>
            <span aria-hidden="true">•</span>
            <time dateTime={current.publishedAt}>{date}</time>
          </div>
          <h2 className="mt-3 line-clamp-2 text-3xl font-bold leading-[1.15] text-white">
            {current.title}
          </h2>
          <p className="mt-3 line-clamp-2 max-w-lg text-sm leading-relaxed text-white/70">
            {current.excerpt}
          </p>
        </motion.div>
      </div>

      {/* Stretched link: the card is the click target. */}
      <a
        href={`#/news/${current.slug}`}
        aria-label={current.title}
        className="absolute inset-0 z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60"
      />

      {/* Pills, bottom-left. */}
      {items.length > 1 && (
        <div className="absolute bottom-5 left-8 z-20 flex items-center gap-2">
          {items.map((item, i) => {
            const isActive = i === activeIndex
            return (
              <button
                key={item.slug}
                type="button"
                aria-label={item.title}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => setIndex(i)}
                className="flex items-center py-2"
              >
                <img
                  src={isActive ? PILLS.active : PILLS.inactive}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  className={cn(
                    'h-[6px] w-6 shrink-0',
                    isActive ? 'opacity-100' : 'opacity-70 transition-opacity hover:opacity-100',
                  )}
                />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
