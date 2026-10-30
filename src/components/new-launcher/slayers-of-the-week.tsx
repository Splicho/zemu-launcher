import { useEffect, useState } from 'react'
import NumberFlow from '@number-flow/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { DisplayName } from '@/components/player/display-name'
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
import { fetchSlayersOfTheWeek, type SlayerEntry } from '@/lib/slayers'

const SKELETON_ROWS = 5
const SECOND_MS = 1_000
const DAY_SECONDS = 86_400
const HOUR_SECONDS = 3_600

/** Kills per match, one decimal — `—` when the player has no matches. */
function formatKillsPerMatch(entry: SlayerEntry): string {
  if (entry.matches <= 0) return '—'
  return (entry.kills / entry.matches).toFixed(1)
}

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
 * suffix (`d` / `h` / `m` / `s`).
 *
 * `trend={-1}` tells NumberFlow the value is falling, so the digits spin
 * downward on each tick instead of upward.
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

/**
 * "Slayers of the Week" — top five kill counts in the current UTC week
 * (Monday 00:00 → now), with a live NumberFlow countdown to the reset.
 *
 * The player cell carries everything that identifies a player in one
 * place: display name, equiped clan tag, then the country flag.
 * Table markup matches the dashboard's `CardTable`.
 */
export function SlayersOfTheWeek({ className }: { className?: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const { data, error } = useQuery({
    queryKey: ['slayers', 'week'],
    queryFn: fetchSlayersOfTheWeek,
    staleTime: 60_000,
  })

  const entries = data?.entries ?? []
  const loading = data === undefined && !error

  const now = useNow()
  const resetsAtMs = data?.resetsAt ? Date.parse(data.resetsAt) : Number.NaN
  const remainingSeconds = Number.isFinite(resetsAtMs)
    ? Math.max(0, Math.floor((resetsAtMs - now) / SECOND_MS))
    : null
  const days =
    remainingSeconds === null ? 0 : Math.floor(remainingSeconds / DAY_SECONDS)
  const hours =
    remainingSeconds === null
      ? 0
      : Math.floor((remainingSeconds % DAY_SECONDS) / HOUR_SECONDS)
  const minutes =
    remainingSeconds === null
      ? 0
      : Math.floor((remainingSeconds % HOUR_SECONDS) / 60)
  const seconds = remainingSeconds === null ? 0 : remainingSeconds % 60

  // At zero the cached payload still carries the previous `resetsAt`, so
  // refetch once to roll the header over to the new week instead of
  // sitting at 00:00:00.
  useEffect(() => {
    if (remainingSeconds !== 0) return
    const id = window.setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: ['slayers', 'week'] })
    }, 5_000)
    return () => window.clearTimeout(id)
  }, [remainingSeconds, queryClient])

  return (
    <section className={className} aria-label={t('slayersTable.title')}>
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{t('slayersTable.title')}</h2>
        {remainingSeconds !== null ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>{t('slayersTable.resetsIn')}</span>
            {days > 0 ? (
              <CountdownUnit value={days} unit={t('slayersTable.unitDays')} />
            ) : null}
            <CountdownUnit
              value={hours}
              unit={t('slayersTable.unitHours')}
              pad
            />
            <CountdownUnit
              value={minutes}
              unit={t('slayersTable.unitMinutes')}
              pad
            />
            <CountdownUnit
              value={seconds}
              unit={t('slayersTable.unitSeconds')}
              pad
            />
          </span>
        ) : null}
      </header>

      <CardTable>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>{t('slayersTable.player')}</TableHead>
              <TableHead className="w-20 text-right">{t('slayersTable.kills')}</TableHead>
              <TableHead className="w-20 text-right">{t('slayersTable.killsPerMatch')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: SKELETON_ROWS }, (_, index) => (
                  <TableRow key={`skeleton-${index}`}>
                    <TableCell>
                      <span className="block h-4 w-3 animate-pulse rounded bg-muted" />
                    </TableCell>
                    <TableCell>
                      <span className="block h-4 w-40 animate-pulse rounded bg-muted" />
                    </TableCell>
                    <TableCell>
                      <span className="ml-auto block h-4 w-10 animate-pulse rounded bg-muted" />
                    </TableCell>
                    <TableCell>
                      <span className="ml-auto block h-4 w-10 animate-pulse rounded bg-muted" />
                    </TableCell>
                  </TableRow>
                ))
              : null}

            {error ? (
              <TableRow>
                <TableCell colSpan={4} className="p-0">
                  <Empty className="py-10">
                    <EmptyTitle>{t('slayersTable.error')}</EmptyTitle>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : null}

            {!error && !loading && entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="p-0">
                  <Empty className="py-10">
                    <EmptyTitle>{t('slayersTable.empty')}</EmptyTitle>
                    <EmptyDescription>{t('slayersTable.emptyHint')}</EmptyDescription>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : null}

            {entries.map((entry, index) => (
              <TableRow key={entry.name}>
                <TableCell className="text-muted-foreground tabular-nums">{index + 1}</TableCell>
                <TableCell className="max-w-0">
                  <DisplayName
                    name={entry.name}
                    href={`#/player/${encodeURIComponent(entry.name)}`}
                    country={entry.country}
                    clan={
                      entry.clanTag
                        ? {
                            tag: entry.clanTag,
                            href: entry.clanSlug ? `#/clan/${entry.clanSlug}` : undefined,
                          }
                        : null
                    }
                    className="font-medium"
                  />
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {entry.kills}
                </TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {formatKillsPerMatch(entry)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardTable>
    </section>
  )
}
