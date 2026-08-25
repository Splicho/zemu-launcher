import { useEffect, useState } from 'react'
import { ArrowLeft, Newspaper } from 'lucide-react'

import { fetchNewsList, formatNewsDate, type NewsListItem } from '@/lib/news'
import { useHashRouter } from '@/hooks/use-hash'

/**
 * News list page — mounted at `#/news`.
 *
 * Renders the full news feed as a responsive grid (no carousel here,
 * unlike the home-page slider). Each card links to its slug page via
 * the hash router; the home sub-router handles which view to render
 * based on the current hash.
 *
 * The "Back" button is the only way out — there's no sidebar entry
 * for news yet, so users land here by clicking "View all" on the
 * slider or a specific news card and need a way to return to the
 * home content.
 */
export function NewsPage() {
  const { navigate } = useHashRouter()
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

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 px-8 pt-6">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-8 pb-8 pt-4">
        <header className="flex items-center gap-2">
          <Newspaper className="size-5 text-foreground" />
          <h1 className="text-xl font-semibold tracking-tight">All news</h1>
        </header>

        {error && (
          <p className="text-sm text-muted-foreground">Couldn't load news: {error}</p>
        )}

        {items === null && !error && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-64 animate-pulse rounded-xl bg-muted/40"
                aria-hidden="true"
              />
            ))}
          </div>
        )}

        {items && items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No news published yet — check back later.
          </p>
        )}

        {items && items.length > 0 && (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <li key={item.slug}>
                <button
                  type="button"
                  onClick={() => navigate(`/news/${item.slug}`)}
                  className="group flex h-full w-full flex-col overflow-hidden rounded-xl bg-card text-left transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted">
                    {item.coverImageUrl ? (
                      <img
                        src={item.coverImageUrl}
                        alt={item.coverImageAlt}
                        loading="lazy"
                        className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/40">
                        <Newspaper className="size-10" aria-hidden="true" />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-2 p-4">
                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <span className="rounded-md bg-muted/60 px-1.5 py-0.5 font-medium text-foreground/80">
                        {item.category}
                      </span>
                      <span>{formatNewsDate(item.publishedAt)}</span>
                    </div>
                    <h3 className="line-clamp-2 text-base font-semibold leading-snug text-foreground">
                      {item.title}
                    </h3>
                    <p className="line-clamp-3 text-sm text-muted-foreground">
                      {item.excerpt}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}