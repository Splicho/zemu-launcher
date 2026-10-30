import { useEffect, useState } from 'react'
import NumberFlow from '@number-flow/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { CardTable } from '@/components/new-launcher/card-table'
import { Badge } from '@/components/ui/badge'
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
const SECOND_MS = 1_000
const DAY_SECONDS = 86_400
const HOUR_SECONDS = 3_600

/** Re-renders every second so the countdown stays live. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), SECOND_MS)
    return () => window.clearInterval(id)
  }, [])
  return now
}

/**
 * One animated countdown unit: a NumberFlow digit group plus its locale
 * suffix (`d` / `h` / `m` / `s`). `trend={-1}` makes the digits spin
 * downward on each tick, matching the Slayers reset countdown.
 */
function CountdownUnit({
  value,
  unit,
  pad = false,
}: {
  value: number
  unit: string
  pad?: boolean
}) {
  return (
    <Badge variant="outline" className="gap-0.5 rounded-md tabular-nums">
      <NumberFlow
        value={value}
        trend={-1}
        format={pad ? { minimumIntegerDigits: 2 } : undefined}
      />
      <span>{unit}</span>
    </Badge>
  )
}

type Countdown = {
  live: boolean
  days: number
  hours: number
  minutes: number
  seconds: number
}

/**
 * Remaining time until the event's next milestone:
 *
 *   - before the start → counts down to `startsAt` ("Starts in")
 *   - between start and end → counts down to `endsAt` and reads "Ends in"
 *     (the event is live — the reason an 11:00–13:00 event stays on the
 *     launcher at 11:30 instead of vanishing)
 *   - legacy rows without `endsAt` → `end == start`, so they fall back to
 *     the old "ends when it starts" behaviour
 *
 * Returns `null` when the timestamps are unusable so the caller can fall
 * back to a plain date.
 */
function remaining(event: UpcomingEvent, now: number): Countdown | null {
  const startMs = Date.parse(event.startsAt)
  if (!Number.isFinite(startMs)) return null
  const endMs = event.endsAt ? Date.parse(event.endsAt) : startMs
  if (!Number.isFinite(endMs)) return null

  const live = now >= startMs && now < endMs
  const target = live ? endMs : startMs
  const total = Math.max(0, Math.floor((target - now) / SECOND_MS))

  return {
    live,
    days: Math.floor(total / DAY_SECONDS),
    hours: Math.floor((total % DAY_SECONDS) / HOUR_SECONDS),
    minutes: Math.floor((total % HOUR_SECONDS) / 60),
    seconds: total % 60,
  }
}

/** `Sat, 8 Nov · 20:00` — used only when the timestamps can't be parsed. */
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
 * The right column is a live countdown rather than a static date: "Starts
 * in 2h 15m" before the event, "Ends in" while it runs. Uses the
 * dashboard's `CardTable` frame + `Table` primitives and an `Empty` state,
 * so it matches the admin tables exactly.
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
  const now = useNow()
  const queryClient = useQueryClient()

  // Once an event's window has closed the cached payload still lists it,
  // so refetch once to drop it instead of leaving "Ends in 00:00:00" up.
  const hasEnded = events.some((event) => {
    const end = event.endsAt ? Date.parse(event.endsAt) : Date.parse(event.startsAt)
    return Number.isFinite(end) && now >= end
  })
  useEffect(() => {
    if (!hasEnded) return
    const id = window.setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: ['events', 'upcoming'] })
    }, 5_000)
    return () => window.clearTimeout(id)
  }, [hasEnded, queryClient])

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
              <TableHead className="w-56 text-right">{t('eventsTable.time')}</TableHead>
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

            {events.map((event) => {
              const time = remaining(event, now)
              return (
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
                    {time ? (
                      <span className="inline-flex items-center justify-end gap-1 text-xs">
                        {time.live ? (
                          <Badge variant="secondary" className="rounded-md">
                            {t('eventsTable.live')}
                          </Badge>
                        ) : null}
                        <span className="text-muted-foreground">
                          {time.live
                            ? t('eventsTable.endsIn')
                            : t('eventsTable.startsIn')}
                        </span>
                        {time.days > 0 ? (
                          <CountdownUnit
                            value={time.days}
                            unit={t('slayersTable.unitDays')}
                          />
                        ) : null}
                        <CountdownUnit
                          value={time.hours}
                          unit={t('slayersTable.unitHours')}
                          pad
                        />
                        <CountdownUnit
                          value={time.minutes}
                          unit={t('slayersTable.unitMinutes')}
                          pad
                        />
                        <CountdownUnit
                          value={time.seconds}
                          unit={t('slayersTable.unitSeconds')}
                          pad
                        />
                      </span>
                    ) : (
                      <time dateTime={event.startsAt}>
                        {formatStartsAt(event.startsAt, locale)}
                      </time>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardTable>
    </section>
  )
}
