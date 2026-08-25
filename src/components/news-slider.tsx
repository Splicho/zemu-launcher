import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { fetchNewsList, formatNewsDate } from '@/lib/news'
import { useHashRouter } from '@/hooks/use-hash'
import { ArrowRight } from './icons'

const SWIPE_THRESHOLD = 60
const AUTO_PLAY_INTERVAL = 6000

function NewsSliderSkeleton() {
  return (
    <div className="news-carousel group relative w-full select-none overflow-hidden focus:outline-none rounded-xl h-80">
      <div className="flex h-full w-full items-center overflow-hidden">
        <div className="h-full w-full bg-muted/30 animate-pulse" />
      </div>
      <div className="absolute left-12 bottom-4 z-20 flex gap-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-1.5 w-8 rounded-full bg-white/30 animate-pulse"
          />
        ))}
      </div>
    </div>
  )
}

export function NewsSlider() {
  const { navigate } = useHashRouter()
  const [index, setIndex] = useState(0)
  const [prevIndex, setPrevIndex] = useState<number | null>(null)
  const [progress, setProgress] = useState(0)

  const { data: items, error } = useQuery({
    queryKey: ['news'],
    queryFn: fetchNewsList,
  })

  const dragStartX = useRef<number | null>(null)
  const [dragOffset, setDragOffset] = useState(0)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const autoPlayRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isTransitioning = prevIndex !== null

  const goToIndex = useCallback((newIndex: number) => {
    setPrevIndex(index)
    setIndex(newIndex)
    setProgress(0)
    setTimeout(() => {
      setPrevIndex(null)
    }, 800)
  }, [index])

  const advance = useCallback(
    (delta: 1 | -1) => {
      if (!items || items.length === 0) return
      const newIndex = (index + delta + items.length) % items.length
      goToIndex(newIndex)
    },
    [index, goToIndex, items],
  )

  // Auto-play with progress
  useEffect(() => {
    if (!items || items.length <= 1) return

    const startProgress = () => {
      setProgress(0)
      progressRef.current = setInterval(() => {
        setProgress((p) => {
          if (p >= 100) return 0
          return p + (100 / (AUTO_PLAY_INTERVAL / 50))
        })
      }, 50)
    }

    const startAutoPlay = () => {
      startProgress()
      autoPlayRef.current = setInterval(() => {
        if (!items || items.length <= 1) return
        const newIndex = (index + 1) % items.length
        goToIndex(newIndex)
      }, AUTO_PLAY_INTERVAL)
    }

    startAutoPlay()

    return () => {
      if (autoPlayRef.current) clearInterval(autoPlayRef.current)
      if (progressRef.current) clearInterval(progressRef.current)
    }
  }, [items, index, goToIndex])

  // Keyboard navigation
  useEffect(() => {
    const node = containerRef.current
    if (!node || !items || items.length <= 1) return
    node.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        advance(1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        advance(-1)
      }
    })
  }, [advance, items])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('[data-pills]')) return
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
    dragStartX.current = e.clientX
    setDragOffset(0)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartX.current === null) return
    const offset = e.clientX - dragStartX.current
    setDragOffset(offset)
  }

  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartX.current === null) return
    const offset = e.clientX - dragStartX.current
    dragStartX.current = null
    setDragOffset(0)
    if (Math.abs(offset) > SWIPE_THRESHOLD) {
      advance(offset < 0 ? 1 : -1)
    }
  }

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
    if (Math.abs(e.deltaX) < 10) return
    advance(e.deltaX > 0 ? 1 : -1)
  }

  if (error) {
    return null
  }

  if (!items || items.length === 0) {
    return <NewsSliderSkeleton />
  }

  const current = items[index]
  const prevItem = prevIndex !== null ? items[prevIndex] : null
  const dragPx = dragOffset
  const isDragging = dragStartX.current !== null

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="news-carousel group relative w-full select-none overflow-hidden focus:outline-none rounded-xl"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onWheel={onWheel}
      style={{ touchAction: 'pan-y' }}
    >
      {/* Clickable card */}
      <button
        type="button"
        onClick={() => {
          if (dragOffset === 0) navigate(`/news/${current.slug}`)
        }}
        className="group relative flex h-80 w-full cursor-pointer items-center overflow-hidden"
      >
        {/* Previous cover (fading out) */}
        {prevItem && (
          <div
            className="absolute inset-0 transition-opacity duration-500 opacity-0"
            style={{ animation: 'fadeOut 500ms ease-out forwards' }}
          >
            <img
              src={prevItem.coverImageUrl ?? ''}
              alt={prevItem.coverImageAlt}
              loading="lazy"
              draggable={false}
              className="size-full object-cover"
            />
          </div>
        )}

        {/* Current cover */}
        <div
          className="absolute inset-0 transition-opacity duration-500"
          style={{
            animation: isTransitioning ? 'fadeIn 500ms ease-out forwards' : undefined,
            opacity: isTransitioning ? 0 : 1,
          }}
        >
          <img
            src={current.coverImageUrl ?? ''}
            alt={current.coverImageAlt}
            loading="lazy"
            draggable={false}
            className="size-full object-cover transition-[filter,transform] duration-300 group-hover:brightness-110"
            style={{
              transform: `translateX(${dragPx}px)`,
              transition: isDragging ? 'none' : undefined,
            }}
          />
        </div>

        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(to right, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.6) 50%, rgba(0,0,0,0) 100%)',
          }}
        />

        {/* Content with fade animation */}
        <div
          className="relative z-10 flex max-w-xl flex-col gap-3 px-12 py-8 text-left"
          style={{
            opacity: isTransitioning ? 0 : 1,
            transform: `translateX(${dragPx}px) translateY(${isTransitioning ? '8px' : '0px'})`,
            transition: isDragging ? 'none' : 'opacity 500ms ease, transform 500ms ease',
          }}
        >
          <div className="flex items-center gap-2 text-xs text-white/60">
            <span className="uppercase tracking-wide">{current.category}</span>
            <span>·</span>
            <span>{formatNewsDate(current.publishedAt)}</span>
          </div>
          <h3 className="line-clamp-2 text-2xl font-bold leading-snug text-white">
            {current.title}
          </h3>
          <p className="line-clamp-2 text-sm text-white/75">{current.excerpt}</p>
          <Button
            variant="gradient"
            size="lg"
            asChild
            className="mt-2 w-fit px-4"
          >
            <a href={`/news/${current.slug}`}>
              <span className="inline-flex items-center gap-2">
                <span>Read more</span>
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            </a>
          </Button>
        </div>
      </button>

      {/* Pill navigation with progress */}
      {items.length > 1 && (
        <div
          data-pills
          className="absolute left-12 bottom-4 z-20 flex gap-2"
          style={{
            transform: `translateX(${dragPx}px)`,
            transition: isDragging ? 'none' : undefined,
          }}
        >
          {items.map((_, i) => {
            const isActive = i === index
            return (
              <button
                key={i}
                type="button"
                aria-label={`Show article ${i + 1}`}
                aria-current={isActive ? 'true' : undefined}
                onClick={(e) => {
                  e.stopPropagation()
                  if (i !== index) goToIndex(i)
                }}
                className="relative h-1.5 w-8 cursor-pointer rounded-full overflow-hidden bg-white/30 hover:bg-white/55 transition-colors"
              >
                <div
                  className="absolute inset-y-0 left-0 bg-white rounded-full"
                  style={{ width: isActive ? `${progress}%` : '0%' }}
                />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
