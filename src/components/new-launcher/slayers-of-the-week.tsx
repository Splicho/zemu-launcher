import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { DisplayName } from '@/components/player/display-name'
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
import { fetchSlayersOfTheWeek, type SlayerEntry } from '@/lib/slayers'

const SKELETON_ROWS = 5

/** Kills per match, one decimal — `—` when the player has no matches. */
function formatKillsPerMatch(entry: SlayerEntry): string {
  if (entry.matches <= 0) return '—'
  return (entry.kills / entry.matches).toFixed(1)
}

/**
 * "Slayers of the Week" — top five kill counts over the last seven days.
 *
 * The player cell carries everything that identifies a player in one
 * place: display name, equiped clan tag, then the country flag.
 * Table markup matches the dashboard's `CardTable`.
 */
export function SlayersOfTheWeek({ className }: { className?: string }) {
  const { t } = useTranslation()

  const { data, error } = useQuery({
    queryKey: ['slayers', 'week'],
    queryFn: fetchSlayersOfTheWeek,
    staleTime: 60_000,
  })

  const entries = data?.entries ?? []
  const loading = data === undefined && !error

  return (
    <section className={className} aria-label={t('slayersTable.title')}>
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">{t('slayersTable.title')}</h2>
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
