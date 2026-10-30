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
  /**
   * False when there is nothing to count toward — an open-ended event
   * while it runs, or a countdown the admin switched off. The row then
   * shows the "Live" badge (or falls back to a plain date) with no
   * digits.
   */
  hasTarget: boolean
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
 *   - `endsAt === null` (open-ended) → live with **no** end to count
 *     toward, so the row reads "Live" with no digits
 *   - `showStartCountdown` / `showEndCountdown` false → the admin hid
 *     that timer, so the row falls back to a plain date / bare "Live"
 *
 * Returns `null` when there is nothing live to show, so the caller can
 * fall back to a plain date.
 */
function remaining(event: UpcomingEvent, now: number): Countdown | null {
  const startMs = Date.parse(event.startsAt)
  if (!Number.isFinite(startMs)) return null

  // A null end is a real state (open-ended), not a legacy stand-in for
  // "ends when it starts" — treat it as "never ends" instead.
  const endMs =
    event.endsAt === null ? Number.POSITIVE_INFINITY : Date.parse(event.endsAt)
  if (Number.isNaN(endMs)) return null

  const live = now >= startMs && now < endMs
  const countdownVisible = live
    ? event.showEndCountdown
    : event.showStartCountdown
  const target = live ? endMs : startMs
  const hasTarget = countdownVisible && Number.isFinite(target)

  // Not live and no timer to render — the caller shows the start date.
  if (!live && !hasTarget) return null

  const total = hasTarget
    ? Math.max(0, Math.floor((target - now) / SECOND_MS))
    : 0

  return {
    live,
    hasTarget,
    days: Math.floor(total / DAY_SECONDS),
    hours: Math.floor((total % DAY_SECONDS) / HOUR_SECONDS),
    minutes: Math.floor((total % HOUR_SECONDS) / 60),
    seconds: total % 60,
  }
}

/**
 * `Sat, 8 Nov · 20:00` — the fallback for the right-hand column when there
 * is no countdown to render: an unparseable timestamp, or a live
 * open-ended event with no end to count toward.
 */
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
 * in 2h 15m" before the event, "Ends in" while it runs, falling back to
 * the start date when there is nothing to count toward. Running events
 * carry a "Live" badge next to the title, where it reads as part of the
 * event's name rather than as a unit of the countdown. Uses the
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
  // Open-ended events have no end to pass — including them here would
  // refetch every 5s forever, since nothing but staff can close them.
  const hasEnded = events.some((event) => {
    if (event.endsAt === null) return false
    const end = Date.parse(event.endsAt)
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
                    <div className="flex items-center gap-2">
                      {time?.live ? (
                        <Badge
                          variant="secondary"
                          className="shrink-0 rounded-md"
                        >
                          {/* Same red-dot convention as `LiveIndicator`; the
                              badge already supplies the gap. Decorative —
                              the "Live" label carries the meaning. */}
                          <span
                            aria-hidden
                            className="size-1.5 shrink-0 rounded-full bg-red-500"
                          />
                          {t('eventsTable.live')}
                        </Badge>
                      ) : null}
                      <a
                        href={`#/event/${event.id}`}
                        title={event.title}
                        className="block min-w-0 flex-1 truncate font-medium hover:underline"
                      >
                        {event.title}
                      </a>
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {time?.hasTarget ? (
                      <span className="inline-flex items-center justify-end gap-1 text-xs">
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
