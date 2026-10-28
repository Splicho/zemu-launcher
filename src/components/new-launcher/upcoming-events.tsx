import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { CardTable } from '@/components/new-launcher/card-table'
import { Empty, EmptyDescription, EmptyTitle } from '@/components/ui/empty'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { fetchUpcomingEvents, type UpcomingEvent } from '@/lib/events'

const ROW_LIMIT = 5
/** Skeleton rows match the final row count so the card doesn't resize. */
const SKELETON_ROWS = ROW_LIMIT

/** `Sat, 8 Nov · 20:00` in the launcher's current language. */
function formatStartsAt(iso: string, locale: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  try {
    const day = new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
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
 * Upcoming events table for the home page.
 *
 * Uses the dashboard's `CardTable` frame + `Table` primitives and an
 * `Empty` state, so it matches the admin tables exactly.
 */
export function UpcomingEvents({ className }: { className?: string }) {
  const { t, i18n } = useTranslation()

  const { data, error } = useQuery({
    queryKey: ['events', 'upcoming'],
    queryFn: () => fetchUpcomingEvents(ROW_LIMIT),
    staleTime: 60_000,
  })

  const events: UpcomingEvent[] = data ?? []
  const loading = data === undefined && !error
  const locale = i18n.language || 'en'

  return (
    <section className={className} aria-label={t('eventsTable.title')}>
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">{t('eventsTable.title')}</h2>
      </header>

      <CardTable>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('eventsTable.event')}</TableHead>
              <TableHead className="w-56 text-right">{t('eventsTable.starts')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: SKELETON_ROWS }, (_, index) => (
                  <TableRow key={`skeleton-${index}`}>
                    <TableCell>
                      <span className="block h-4 w-48 animate-pulse rounded bg-muted" />
                    </TableCell>
                    <TableCell>
                      <span className="ml-auto block h-4 w-32 animate-pulse rounded bg-muted" />
                    </TableCell>
                  </TableRow>
                ))
              : null}

            {error ? (
              <TableRow>
                <TableCell colSpan={2} className="p-0">
                  <Empty className="py-10">
                    <EmptyTitle>{t('eventsTable.error')}</EmptyTitle>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : null}

            {!error && !loading && events.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} className="p-0">
                  <Empty className="py-10">
                    <EmptyTitle>{t('eventsTable.empty')}</EmptyTitle>
                    <EmptyDescription>{t('eventsTable.emptyHint')}</EmptyDescription>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : null}

            {events.map((event) => (
              <TableRow key={event.id}>
                <TableCell className="max-w-0">
                  <a
                    href={`#/event/${event.id}`}
                    title={event.title}
                    className="block truncate font-medium hover:underline"
                  >
                    {event.title}
                  </a>
                </TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  <time dateTime={event.startsAt}>{formatStartsAt(event.startsAt, locale)}</time>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardTable>
    </section>
  )
}
