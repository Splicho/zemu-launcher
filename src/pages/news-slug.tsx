import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'

import { fetchNewsBySlug, formatNewsDate, type NewsFull } from '@/lib/news'
import { useHashRouter } from '@/hooks/use-hash'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { NewsBody } from '@/components/news-body'

/**
 * News detail page — mounted at `#/news/:slug`.
 *
 * Fetches the full post (with `bodyHtml`) on mount and renders it.
 * The hash router passes the slug straight through `window.location.hash`
 * — we parse it here because `useHash()` returns the full hash string.
 *
 * `bodyHtml` is rendered via `dangerouslySetInnerHTML`. The content
 * comes from the public news API which we control, so it's trusted;
 * if that ever changes, swap this for a sanitizer (DOMPurify) or a
 * markdown renderer.
 *
 * 404s surface as "Post not found" rather than throwing — the API
 * conflates missing and unpublished, and neither warrants a noisy
 * error state.
 */
export function NewsSlugPage({ slug }: { slug: string }) {
  const { t } = useTranslation()
  const { navigate } = useHashRouter()
  const [post, setPost] = useState<NewsFull | null | 'loading' | 'missing'>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setPost('loading')
    setError(null)
    fetchNewsBySlug(slug)
      .then((result) => {
        if (cancelled) return
        setPost(result ?? 'missing')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load post')
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 px-8 py-4">
        <Button
          onClick={() => navigate('/news')}
          variant="outline"
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {t('news.backToNews')}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-10 pt-4">
        <div className="flex flex-col gap-6">
          {post === 'loading' && (
            <div className="flex flex-col gap-4">
              <div className="h-8 w-2/3 animate-pulse rounded-md bg-muted/40" />
              <div className="h-4 w-1/3 animate-pulse rounded-md bg-muted/40" />
              <div className="aspect-[16/9] w-full animate-pulse rounded-xl bg-muted/40" />
              <div className="flex flex-col gap-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-4 w-full animate-pulse rounded-md bg-muted/30" />
                ))}
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-muted-foreground">
              {t('news.failedLoadPost', { error })}
            </p>
          )}

          {post === 'missing' && (
            <div className="flex flex-col gap-3">
              <h1 className="text-2xl font-semibold">{t('news.postNotFound')}</h1>
              <p className="text-sm text-muted-foreground">
                {t('news.postNotFoundDesc')}
              </p>
            </div>
          )}

          {post && post !== 'loading' && post !== 'missing' && (
            <article className="flex flex-col gap-6">
              {post.coverImageUrl && (
                <img
                  src={post.coverImageUrl}
                  alt={post.coverImageAlt}
                  className="aspect-[16/9] w-full rounded-xl object-cover"
                />
              )}

              <header className="flex flex-col gap-3">
                <div className="flex items-center gap-2 tracking-wide text-muted-foreground">
                  <Badge variant="outline" className="rounded-sm">
                    {post.category} 
                  </Badge>
                  <span className="text-xs">•</span>
                  <span className="text-sm">{formatNewsDate(post.publishedAt)}</span>
                </div>
                <h1 className="text-3xl font-semibold leading-tight tracking-tight">
                  {post.title}
                </h1>
                {post.excerpt && (
                  <p className="text-base text-muted-foreground">{post.excerpt}</p>
                )}
              </header>
              <Separator />
              <NewsBody html={post.bodyHtml} className="typeset typeset-docs max-w-none text-sm leading-relaxed" />
            </article>
          )}
        </div>
      </div>
    </div>
  )
}