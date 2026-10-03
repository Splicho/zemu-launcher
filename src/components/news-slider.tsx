import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'

import { Button } from '@/components/ui/button'
import { fetchNewsList, formatNewsDate } from '@/lib/news'
import { useHashRouter } from '@/hooks/use-hash'
import { cn } from '@/lib/utils'

const SWIPE_THRESHOLD = 60
const AUTO_PLAY_INTERVAL = 6000
// The hero rotates through the newest articles only; older ones live
// on the News page. Keeps the headline rail short enough to fit.
const MAX_ITEMS = 5

const HERO_HEIGHT = 'h-[min(28rem,58vh)] min-h-80'

function NewsSliderSkeleton() {
  return <div className={cn('w-full animate-pulse bg-muted/30', HERO_HEIGHT)} />
}

/**
 * Full-bleed news hero at the top of Home. Covers crossfade behind a
 * left-aligned headline; on wide windows a rail on the right lists the
 * articles in rotation, with a fill bar on the active one counting down
 * to the next. Narrow windows fall back to pill indicators.
 *
 * Auto-advance is driven by the indicator's CSS animation (`news-progress`
 * in index.css): when it ends we move on. Hovering or focusing the hero
 * pauses it. Swipe, horizontal wheel and arrow keys also navigate.
 */
export function NewsSlider() {
  const { t } = useTranslation()
  const { navigate } = useHashRouter()
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [dragOffset, setDragOffset] = useState(0)
  const dragStartX = useRef<number | null>(null)

  const { data, error } = useQuery({
    queryKey: ['news'],
    queryFn: fetchNewsList,
  })
  const items = data?.slice(0, MAX_ITEMS)

  const count = items?.length ?? 0
  const advance = (delta: 1 | -1) => {
    if (count <= 1) return
    setIndex((i) => (i + delta + count) % count)
  }

  if (error) return null
  if (!items || items.length === 0) return <NewsSliderSkeleton />

  const current = items[Math.min(index, items.length - 1)]

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('[data-news-nav]')) return
    dragStartX.current = e.clientX
    setDragOffset(0)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartX.current === null) return
    setDragOffset(e.clientX - dragStartX.current)
  }
  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartX.current === null) return
    const offset = e.clientX - dragStartX.current
    dragStartX.current = null
    setDragOffset(0)
    if (Math.abs(offset) > SWIPE_THRESHOLD) advance(offset < 0 ? 1 : -1)
  }
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Math.abs(e.deltaX) < 10) return
    advance(e.deltaX > 0 ? 1 : -1)
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      advance(1)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      advance(-1)
    }
  }

  // Only the visible indicator (rail on lg+, pills below) runs the
  // countdown; `display: none` elements don't fire animation events.
  // `motion-reduce:hidden` therefore also turns auto-advance off for
  // people who prefer reduced motion.
  const progressBar = (active: boolean) =>
    active && items.length > 1 ? (
      <span
        key={`progress-${index}`}
        aria-hidden="true"
        onAnimationEnd={() => advance(1)}
        className="absolute inset-0 origin-left bg-white motion-reduce:hidden"
        style={{
          animation: `news-progress ${AUTO_PLAY_INTERVAL}ms linear forwards`,
          animationPlayState: paused ? 'paused' : 'running',
        }}
      />
    ) : null

  return (
    <section
      aria-roledescription="carousel"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      // Keyboard focus pauses; a mouse click inside shouldn't leave it
      // paused after the pointer has left.
      onFocus={(e) => {
        if (e.target.matches(':focus-visible')) setPaused(true)
      }}
      onBlur={() => setPaused(false)}
      onWheel={onWheel}
      style={{ touchAction: 'pan-y' }}
      className={cn(
        'relative isolate w-full select-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        HERO_HEIGHT,
      )}
    >
      {/* All covers stay mounted and crossfade on opacity. */}
      {items.map((item, i) => (
        <img
          key={item.slug}
          src={item.coverImageUrl ?? ''}
          alt={i === index ? item.coverImageAlt : ''}
          aria-hidden={i !== index}
          draggable={false}
          className={cn(
            'absolute inset-0 -z-20 size-full object-cover transition-opacity duration-700 ease-out motion-reduce:transition-none',
            i === index ? 'opacity-100' : 'opacity-0',
          )}
          style={i === index && dragOffset ? { transform: `translateX(${dragOffset}px)` } : undefined}
        />
      ))}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,rgb(0_0_0/0.85)_0%,rgb(0_0_0/0.55)_45%,rgb(0_0_0/0.15)_100%)]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-t from-background via-transparent to-transparent"
      />

      <div className="flex h-full items-end gap-8 px-6 pb-10 sm:px-8">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={current.slug}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            className="flex max-w-xl min-w-0 flex-1 flex-col gap-3"
          >
            <div className="flex items-center gap-3 text-sm text-white/70">
              <span className="rounded-sm bg-white/15 px-2 py-0.5 text-xs font-medium text-white">
                {current.category}
              </span>
              <time dateTime={current.publishedAt}>{formatNewsDate(current.publishedAt)}</time>
            </div>
            <h2 className="line-clamp-2 text-4xl leading-tight font-bold tracking-tight text-white">
              {current.title}
            </h2>
            <p className="line-clamp-2 max-w-[60ch] text-white/75">{current.excerpt}</p>
            <Button
              variant="gradient"
              size="lg"
              className="mt-2 w-fit px-4"
              data-news-nav
              onClick={() => navigate(`/news/${current.slug}`)}
            >
              {t('news.readMore')}
            </Button>
          </motion.div>
        </AnimatePresence>

        {/* Headline rail (wide windows). */}
        {items.length > 1 ? (
          <ol data-news-nav className="ml-auto hidden w-72 shrink-0 flex-col gap-1 lg:flex">
            {items.map((item, i) => {
              const active = i === index
              return (
                <li key={item.slug}>
                  <button
                    type="button"
                    onClick={() => setIndex(i)}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'relative flex w-full flex-col gap-0.5 overflow-hidden rounded-md px-3 py-2.5 text-left backdrop-blur-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active ? 'bg-white/15' : 'bg-black/20 hover:bg-white/10',
                    )}
                  >
                    <span
                      className={cn(
                        'line-clamp-1 text-sm font-medium',
                        active ? 'text-white' : 'text-white/70',
                      )}
                    >
                      {item.title}
                    </span>
                    <span className="text-xs text-white/50">
                      {formatNewsDate(item.publishedAt)}
                    </span>
                    <span className="absolute inset-x-0 bottom-0 h-0.5 bg-white/10">
                      {progressBar(active)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        ) : null}
      </div>

      {/* Pill indicators (narrow windows). */}
      {items.length > 1 ? (
        <div data-news-nav className="absolute bottom-4 left-6 flex gap-2 sm:left-8 lg:hidden">
          {items.map((item, i) => (
            <button
              key={item.slug}
              type="button"
              aria-label={t('news.showArticle', { index: i + 1 })}
              aria-current={i === index ? 'true' : undefined}
              onClick={() => setIndex(i)}
              className="relative h-1.5 w-8 overflow-hidden rounded-full bg-white/30 transition-colors hover:bg-white/55"
            >
              {progressBar(i === index)}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  )
}
