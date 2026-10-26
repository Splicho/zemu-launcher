import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { fetchNewsList, type NewsListItem } from '@/lib/news'
import { NewsCard } from '@/components/news-card'

/**
 * News list page — mounted at `#/news`.
 *
 * Renders the full news feed as a responsive grid (no carousel here,
 * unlike the home-page slider). Each card links to its slug page via
 * the hash router; the home sub-router handles which view to render
 * based on the current hash.
 *
 * News is a top-level sidebar destination. Article detail pages
 * provide their own return navigation to this list.
 */
export function NewsPage() {
  const { t } = useTranslation()
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
          setError(err instanceof Error ? err.message : null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-8 pb-8 pt-6">
        <header>
          <h1 className="text-3xl tracking-tight">{t('news.allNews')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('news.subtitle')}
          </p>
        </header>

        {error && (
          <p className="text-sm text-muted-foreground">{t('news.failedLoadNews', { error })}</p>
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
            {t('news.noNews')}
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
