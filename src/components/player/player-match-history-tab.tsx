import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'

import { CardTable } from '@/components/new-launcher/card-table'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { DisplayName } from '@/components/player/display-name'
import {
  fetchMatchDetail,
  type PlayerMatchDetail,
  type PlayerMatchDetailPlayer,
  type PlayerRecentMatch,
} from '@/lib/player-stats'
import { cn } from '@/lib/utils'

/**
 * Match history tab, built on the same framed table markup as the admin
 * dashboard (`CardTable` + `Table`).
 *
 * Ported from the website's `player-match-history-tab.tsx`: the player's 20
 * most recent matches, each row expandable into the full lobby, which is
 * fetched on first open from `/v1/stats/matches/:id` and cached while the row
 * stays mounted.
 */

/** Explicit UTC so every row reads the same regardless of the machine. */
const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
})

const TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
})

const INTEGER_FORMAT = new Intl.NumberFormat('en-US')

/** Rows shown in the history table. */
const RECENT_MATCH_LIMIT = 20

const EM_DASH = '—'

/** Two-letter fallback for players without an avatar. */
function playerInitials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase() || '?'
}

/** Match length, e.g. `32m` or `1h 05m`. */
function matchDuration(startedAt: number, endedAt: number): string {
  const totalMinutes = Math.max(1, Math.round((endedAt - startedAt) / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

/** Placement chip: success badge for a top-10 finish, muted otherwise. */
function PlacementBadge({ placement }: { placement: number | null }) {
  if (placement == null) {
    return <span className="text-muted-foreground">{EM_DASH}</span>
  }
  if (placement <= 10) {
    return (
      <Badge
        variant="outline"
        className="rounded-lg border-success/40 bg-success/15 text-success tabular-nums"
      >
        #{placement}
      </Badge>
    )
  }
  return <span className="text-muted-foreground tabular-nums">#{placement}</span>
}

type DetailState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; detail: PlayerMatchDetail }

/**
 * Expanded row: the match's full lobby. The fetch is deferred until the row
 * is first opened, and the result is kept while the row stays mounted so
 * collapsing and re-opening is instant.
 */
function MatchDetailPanel({ matchId, open }: { matchId: string; open: boolean }) {
  const { t } = useTranslation()
  const [state, setState] = useState<DetailState>({ status: 'loading' })
  const loaded = useRef(false)

  useEffect(() => {
    // `loaded` only skips refetching after a successful load: the in-flight
    // request is not guarded by a ref, so a remount can always retry.
    if (!open || loaded.current) return

    let cancelled = false
    fetchMatchDetail(matchId)
      .then((detail) => {
        if (cancelled) return
        if (!detail) {
          setState({ status: 'error' })
          return
        }
        loaded.current = true
        setState({ status: 'ready', detail })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' })
      })

    return () => {
      cancelled = true
    }
  }, [matchId, open])

  if (state.status === 'loading') {
    return (
      <div className="space-y-2 bg-muted/30 px-4 py-4">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-4 w-full" />
        ))}
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <p className="bg-muted/30 px-4 py-4 text-sm text-muted-foreground">
        {t('player.matchHistory.detailError')}
      </p>
    )
  }

  const { detail } = state
  const players = [...detail.players].sort(
    (a, b) => (a.placement ?? Number.POSITIVE_INFINITY) - (b.placement ?? Number.POSITIVE_INFINITY),
  )

  return (
    <div className="bg-muted/30 px-4 py-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="gap-1.5 rounded-lg p-3 capitalize">
          <Badge variant="secondary" className="-ml-2.5 rounded-md px-1.5 py-0 text-[10px]">
            {detail.region}
          </Badge>
          {detail.mode}
        </Badge>
        <Badge variant="outline" className="gap-1.5 rounded-lg p-3">
          <Badge variant="secondary" className="-ml-2.5 rounded-md px-1.5 py-0 text-[10px]">
            {detail.playerCount}
          </Badge>
          {t('player.matchHistory.playersLabel')}
        </Badge>
        <Badge variant="outline" className="rounded-lg p-3">
          {t('player.matchHistory.startedLabel', {
            date: DATE_FORMAT.format(new Date(detail.startedAt)),
          })}
        </Badge>
        <Badge variant="outline" className="gap-1.5 rounded-lg p-3">
          <Badge variant="secondary" className="-ml-2.5 rounded-md px-1.5 py-0 text-[10px]">
            {matchDuration(detail.startedAt, detail.endedAt)}
          </Badge>
          {t('player.matchHistory.endedLabel', {
            time: TIME_FORMAT.format(new Date(detail.endedAt)),
          })}
        </Badge>
      </div>

      <div className="max-h-80 overflow-y-auto rounded-lg border border-border/60 bg-card">
        <div className="flex items-center gap-3 border-b border-border/60 px-3 py-2 text-xs font-medium text-muted-foreground">
          <span className="w-8 text-right">#</span>
          <span className="flex-1">{t('player.matchHistory.playerColumn')}</span>
          <span className="w-14 text-right">{t('player.matchHistory.killsColumn')}</span>
          <span className="w-24 text-right">{t('player.matchHistory.scoreColumn')}</span>
        </div>
        <ul className="divide-y divide-border/60">
          {players.map((player: PlayerMatchDetailPlayer) => (
            <li key={player.name} className="flex items-center gap-3 px-3 py-1.5 text-sm">
              <span className="w-8 text-right text-muted-foreground tabular-nums">
                {player.placement ?? EM_DASH}
              </span>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <Avatar className="size-6">
                  {player.avatarUrl ? <AvatarImage src={player.avatarUrl} alt="" /> : null}
                  <AvatarFallback className="text-[10px]">
                    {playerInitials(player.name)}
                  </AvatarFallback>
                </Avatar>
                <DisplayName
                  name={player.name}
                  href={`#/player/${encodeURIComponent(player.name)}`}
                  clan={
                    player.clan
                      ? { tag: player.clan.tag, href: `#/clan/${player.clan.slug}` }
                      : null
                  }
                  country={player.country}
                  royalty={player.royalty}
                  className="min-w-0 flex-1"
                  nameClassName="font-medium underline-offset-4 hover:underline"
                />
              </span>
              <span className="w-14 text-right tabular-nums">
                {INTEGER_FORMAT.format(player.kills)}
              </span>
              <span className="w-24 text-right text-muted-foreground tabular-nums">
                {INTEGER_FORMAT.format(player.score)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/**
 * One match row plus its collapsible detail row. The detail row stays mounted
 * through the collapse transition and unmounts afterwards, so collapsed rows
 * leave no empty bordered row behind.
 */
function MatchRow({
  match,
  expanded,
  onToggle,
}: {
  match: PlayerRecentMatch
  expanded: boolean
  onToggle: () => void
}) {
  const [rendered, setRendered] = useState(expanded)
  const [open, setOpen] = useState(expanded)

  useEffect(() => {
    if (expanded) {
      setRendered(true)
      const frame = requestAnimationFrame(() => setOpen(true))
      return () => cancelAnimationFrame(frame)
    }

    setOpen(false)
    if (!rendered) return
    const timer = window.setTimeout(() => setRendered(false), 300)
    return () => window.clearTimeout(timer)
  }, [expanded, rendered])

  return (
    <>
      <TableRow
        className={cn(
          // Zebra comes from `CardTable` now, so alternating rows stay
          // consistent with the home tables.
          'cursor-pointer [&>td]:transition-colors',
          'hover:[&>td]:bg-muted/70!',
        )}
        aria-expanded={expanded}
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onToggle()
          }
        }}
      >
        <TableCell className="whitespace-nowrap text-muted-foreground">
          {DATE_FORMAT.format(new Date(match.startedAt))}
        </TableCell>
        <TableCell>
          <Badge variant="secondary">{match.mode || EM_DASH}</Badge>
        </TableCell>
        <TableCell className="text-muted-foreground">{match.region || EM_DASH}</TableCell>
        <TableCell className="text-right">
          <PlacementBadge placement={match.placement} />
        </TableCell>
        <TableCell className="text-right tabular-nums">{match.kills}</TableCell>
        <TableCell className="text-right tabular-nums">
          {INTEGER_FORMAT.format(match.score)}
        </TableCell>
        <TableCell className="text-right text-muted-foreground tabular-nums">
          {match.playerCount}
        </TableCell>
        <TableCell className="max-w-[180px]" title={match.winner ?? undefined}>
          {match.winner ? (
            <span className="flex min-w-0 items-center gap-2">
              <Avatar className="size-5">
                {match.winnerAvatarUrl ? <AvatarImage src={match.winnerAvatarUrl} alt="" /> : null}
                <AvatarFallback className="text-[9px]">
                  {playerInitials(match.winner)}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0" onClick={(event) => event.stopPropagation()}>
                <DisplayName
                  name={match.winner}
                  href={`#/player/${encodeURIComponent(match.winner)}`}
                  clan={
                    match.winnerClan
                      ? { tag: match.winnerClan.tag, href: `#/clan/${match.winnerClan.slug}` }
                      : null
                  }
                  country={match.winnerCountry}
                  royalty={match.winnerRoyalty}
                  size="sm"
                  nameClassName="underline-offset-4 hover:underline"
                />
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">{EM_DASH}</span>
          )}
        </TableCell>
        <TableCell className="w-8 text-right">
          <ChevronDown
            className={cn(
              'size-4 text-muted-foreground transition-transform duration-300',
              expanded && 'rotate-180',
            )}
          />
        </TableCell>
      </TableRow>
      {rendered ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={9} className="p-0">
            <div
              className={cn(
                'grid transition-[grid-template-rows] duration-300 ease-out',
                open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
              )}
            >
              <div className="overflow-hidden">
                <MatchDetailPanel matchId={match.id} open={expanded} />
              </div>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}

export function PlayerMatchHistoryTab({
  matches,
}: {
  /** Newest first; up to 1000 rows from the profile fetch. */
  matches: PlayerRecentMatch[]
}) {
  const { t } = useTranslation()
  const rows = matches.slice(0, RECENT_MATCH_LIMIT)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (rows.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t('player.matchHistory.emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('player.matchHistory.emptyDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const toggle = (id: string) => {
    setExpandedId((current) => (current === id ? null : id))
  }

  return (
    <CardTable>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('player.matchHistory.whenColumn')}</TableHead>
            <TableHead>{t('player.matchHistory.modeColumn')}</TableHead>
            <TableHead>{t('player.matchHistory.regionColumn')}</TableHead>
            <TableHead className="text-right">{t('player.matchHistory.placementColumn')}</TableHead>
            <TableHead className="text-right">{t('player.matchHistory.killsColumn')}</TableHead>
            <TableHead className="text-right">{t('player.matchHistory.scoreColumn')}</TableHead>
            <TableHead className="text-right">{t('player.matchHistory.lobbyColumn')}</TableHead>
            <TableHead>{t('player.matchHistory.winnerColumn')}</TableHead>
            <TableHead className="w-8">
              <span className="sr-only">{t('player.matchHistory.detailsColumn')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((match) => (
            <MatchRow
              key={match.id}
              match={match}
              expanded={expandedId === match.id}
              onToggle={() => toggle(match.id)}
            />
          ))}
        </TableBody>
      </Table>
    </CardTable>
  )
}
