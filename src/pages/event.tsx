import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'

import { NewsBody } from '@/components/news-body'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useHashRouter } from '@/hooks/use-hash'
import { fetchEventById, type EventFull } from '@/lib/events'

/** `Sat, 8 Nov · 20:00` in the launcher's current language. */
function formatEventDate(iso: string, locale: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  try {
    const day = new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date)
    const time = new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
    return `${day} · ${time}`
  } catch {
    return date.toLocaleString()
  }
}

/**
 * `11:00 – 13:00` when the event ends on the same day, or
 * `11:00 – 9 Nov, 02:00` when it doesn't. Empty when there is no end, so
 * an open-ended event keeps a single-date line (its "Open-ended" badge
 * carries the missing end).
 */
function formatEventRange(
  startsAt: string,
  endsAt: string | null,
  locale: string
): string {
  if (!endsAt) return ''
  const start = new Date(startsAt)
  const end = new Date(endsAt)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return ''
  try {
    const time = (date: Date) =>
      new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
      }).format(date)
    if (start.toDateString() === end.toDateString()) {
      return `${time(start)} – ${time(end)}`
    }
    const endDay = new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
    }).format(end)
    return `${time(start)} – ${endDay}, ${time(end)}`
  } catch {
    return ''
  }
}

/**
 * Event detail page — mounted at `#/event/:id`.
 *
 * Mirrors the news detail page (`pages/news-slug.tsx`): the table has no
 * slug column, so the route carries the event id. The body is rendered
 * through `NewsBody`, which also swaps `<video>` elements for the
 * launcher's player — the same treatment news posts get.
 *
 * `descriptionHtml` comes from the public API we control (the admin
 * editor sanitises on write), so `dangerouslySetInnerHTML` is acceptable
 * here for the same reason it is on the news page.
 */
export function EventPage({ id }: { id: string }) {
  const { t, i18n } = useTranslation()
  const { navigate } = useHashRouter()
  const [event, setEvent] = useState<EventFull | null | 'loading' | 'missing'>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setEvent('loading')
    setError(null)
    fetchEventById(id)
      .then((result) => {
        if (cancelled) return
        setEvent(result ?? 'missing')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load event')
      })
    return () => {
      cancelled = true
    }
  }, [id])

  return (
    <div className="flex flex-1 flex-col overflow-hidden text-foreground">
      <div className="flex shrink-0 items-center gap-3 px-8 py-4">
        <Button
          onClick={() => navigate('/')}
          variant="outline"
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {t('eventPage.back')}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-10 pt-4">
        <div className="flex flex-col gap-6">
          {event === 'loading' && (
            <div className="flex flex-col gap-4">
              <div className="h-8 w-2/3 animate-pulse rounded-md bg-muted/40" />
              <div className="h-4 w-1/3 animate-pulse rounded-md bg-muted/40" />
              <div className="h-32 w-full animate-pulse rounded-xl bg-muted/40 sm:h-40" />
              <div className="flex flex-col gap-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-4 w-full animate-pulse rounded-md bg-muted/30" />
                ))}
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-muted-foreground">
              {t('eventPage.failedLoad', { error })}
            </p>
          )}

          {event === 'missing' && (
            <div className="flex flex-col gap-3">
              <h1 className="text-2xl font-semibold">{t('eventPage.notFound')}</h1>
              <p className="text-sm text-muted-foreground">{t('eventPage.notFoundDesc')}</p>
            </div>
          )}

          {event && event !== 'loading' && event !== 'missing' && (
            <article className="flex flex-col gap-6">
              {event.coverImageUrl && (
                <img
                  src={event.coverImageUrl}
                  alt={event.coverAlt ?? ''}
                  className="h-32 w-full rounded-xl object-cover sm:h-40"
                />
              )}

              <header className="flex flex-col gap-3">
                <div className="flex items-center gap-2 tracking-wide text-muted-foreground">
                  <Badge variant="outline" className="rounded-sm">
                    {t('eventPage.badge')}
                  </Badge>
                  {event.isOpenEnded ? (
                    <Badge variant="secondary" className="rounded-sm">
                      {t('eventPage.openEnded')}
                    </Badge>
                  ) : null}
                  <span className="text-xs">•</span>
                  <span className="text-sm">
                    {formatEventDate(event.startsAt, i18n.language || 'en')}
                    {event.endsAt
                      ? ` · ${formatEventRange(
                          event.startsAt,
                          event.endsAt,
                          i18n.language || 'en'
                        )}`
                      : null}
                  </span>
                </div>
                <h1 className="text-3xl font-semibold leading-tight tracking-tight">
                  {event.title}
                </h1>
              </header>

              <Separator />

              {event.descriptionHtml ? (
                <NewsBody
                  html={event.descriptionHtml}
                  className="typeset typeset-docs max-w-none text-sm leading-relaxed"
                />
              ) : (
                <p className="text-sm text-muted-foreground">{t('eventPage.noDescription')}</p>
              )}
            </article>
          )}
        </div>
      </div>
    </div>
  )
}

