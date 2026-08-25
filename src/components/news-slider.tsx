import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { fetchNewsList, formatNewsDate, type NewsListItem } from '@/lib/news'
import { useHashRouter } from '@/hooks/use-hash'
import { ArrowRight } from './icons'

const SWIPE_THRESHOLD = 60

export function NewsSlider() {
  const { navigate } = useHashRouter()
  const [items, setItems] = useState<NewsListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)

  // Drag state
  const dragStartX = useRef<number | null>(null)
  const [dragOffset, setDragOffset] = useState(0)
  const containerRef = useRef<HTMLDivElement | null>(null)

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

  const advance = useCallback(
    (delta: 1 | -1) => {
      setItems((current) => {
        if (!current || current.length === 0) return current
        setIndex((i) => (i + delta + current.length) % current.length)
        return current
      })
    },
    [],
  )

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
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
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
    if (Math.abs(offset) > SWIPE_THRESHOLD) {
      advance(offset < 0 ? 1 : -1)
    }
  }

  // Horizontal mousewheel navigation
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
    if (Math.abs(e.deltaX) < 10) return
    advance(e.deltaX > 0 ? 1 : -1)
  }

  if (error || items === null || items.length === 0) {
    return null
  }

  const current = items[index]
  const dragPx = dragOffset
  const isDragging = dragStartX.current !== null

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="news-carousel relative w-full select-none overflow-hidden focus:outline-none rounded-xl"
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
        <img
          src={current.coverImageUrl ?? ''}
          alt={current.coverImageAlt}
          loading="lazy"
          draggable={false}
          className="absolute inset-0 size-full object-cover transition-[filter,transform] duration-300 group-hover:brightness-110"
          style={{
            transform: `translateX(${dragPx}px)`,
            transition: isDragging ? 'none' : undefined,
          }}
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(to right, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.6) 50%, rgba(0,0,0,0) 100%)',
          }}
        />
        <div
          className="relative z-10 flex max-w-xl flex-col gap-3 px-12 py-8 text-left"
          style={{
            transform: `translateX(${dragPx}px)`,
            transition: isDragging ? 'none' : undefined,
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

      {/* Pill navigation - outside button to avoid pointer capture interference */}
      {items.length > 1 && (
        <div
          className="absolute left-12 bottom-4 z-20 flex gap-2"
          style={{
            transform: `translateX(${dragPx}px)`,
            transition: isDragging ? 'none' : undefined,
          }}
        >
          {items.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Show article ${i + 1}`}
              aria-current={i === index ? 'true' : undefined}
              onClick={(e) => {
                e.stopPropagation()
                setIndex(i)
              }}
              className={`h-1.5 w-8 cursor-pointer rounded-full transition-colors ${
                i === index
                  ? 'bg-white'
                  : 'bg-white/30 hover:bg-white/55'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}