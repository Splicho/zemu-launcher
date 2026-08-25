import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'

import { fetchNewsList, type NewsListItem } from '@/lib/news'
import { useHashRouter } from '@/hooks/use-hash'
import { NewsCard } from '@/components/news-card'
import { Button } from '@/components/ui/button'

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
        <Button
          variant="outline"
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back
        </Button>
      </div>

      <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-8 pb-8 pt-4">
        <header className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">All news</h1>
        </header>

        {error && (
          <p className="text-sm text-muted-foreground">Couldn't load news: {error}</p>
        )}

        {items === null && !error && (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-72 animate-pulse rounded-xl bg-muted/40"
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
          <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {items.map((item) => (
              <li key={item.slug}>
                <NewsCard
                  slug={item.slug}
                  category={item.category}
                  coverImageUrl={item.coverImageUrl}
                  coverImageAlt={item.coverImageAlt}
                  publishedAt={item.publishedAt}
                  title={item.title}
                  excerpt={item.excerpt}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
