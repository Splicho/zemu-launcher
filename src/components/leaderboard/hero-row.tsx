"use client"

import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePlayerTopMatches } from '@/hooks/use-leaderboard'
import type { LeaderboardEntry } from '@/lib/leaderboard'
import { RankBadge } from '@/components/leaderboard/rank-badge'
import { CountryFlagThumb } from '@/components/leaderboard/country-flag-thumb'
import { ClantagBadge } from '@/components/leaderboard/clantag-badge'
import { PlayerGames } from '@/components/leaderboard/player-games'

/**
 * Standalone "YOU" row, rendered between the filter bar and the
 * leaderboard table. Compact summary (Position · Name · Tier · Top
 * 10 Total Score) with the same amber "you" affordance the
 * previous in-table hero row had, plus click-to-expand to load
 * the signed-in player's top-10 matches.
 *
 * The row stays visible when the user's entry is filtered out of
 * the main table — `dimmed` styles drop opacity to communicate
 * "you'd be filtered out right now", and the position cell adds a
 * "Filtered out" caption so the position number still reflects the
 * actual standings (not the filtered view).
 */
export function HeroRow({
  entry,
  clanTags = {},
  dimmed = false,
}: {
  entry: LeaderboardEntry
  clanTags?: Record<string, { clanSlug: string; clanName: string; clantag: string }>
  dimmed?: boolean
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null)
  const topMatchesQuery = usePlayerTopMatches(expandedPlayer)
  const expandedMatches = topMatchesQuery.data ?? []
  const isLoadingMatches = topMatchesQuery.isFetching

  const handleToggle = useCallback(() => {
    if (expanded) {
      setExpanded(false)
      setExpandedPlayer(null)
      return
    }
    setExpanded(true)
    setExpandedPlayer(entry.name)
    void topMatchesQuery.refetch()
  }, [expanded, entry.name, topMatchesQuery])

  const clan = clanTags[entry.name.toLowerCase()] ?? null

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border-2 border-amber-500/60 bg-amber-500/10',
        'transition-opacity',
        dimmed && 'opacity-60 hover:opacity-90',
      )}
      data-hero-row="true"
    >
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={expanded}
        className={cn(
          'flex w-full items-center gap-4 px-4 py-3 text-left',
          'transition-colors hover:bg-amber-500/15',
        )}
      >
        {/* Position */}
        <div className="flex w-14 shrink-0 flex-col items-center gap-0.5">
          <span className="font-mono font-semibold tabular-nums">
            #{entry.position}
          </span>
          {dimmed && (
            <span className="text-[10px] tracking-wide uppercase text-foreground/60">
              {t('leaderboardPage.heroFilteredOut')}
            </span>
          )}
        </div>

        {/* Name + YOU badge */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <a
            href={`#/player/${encodeURIComponent(entry.name)}`}
            onClick={event => event.stopPropagation()}
            className="truncate font-medium hover:underline"
          >
            {entry.name}
          </a>
          {entry.country && (
            <CountryFlagThumb code={entry.country} size={16} className="shrink-0" />
          )}
          {clan && (
            <ClantagBadge
              tag={clan.clantag}
              href={`#/clan/${clan.clanSlug}`}
              size="sm"
              className="shrink-0"
            />
          )}
          <span className="inline-flex shrink-0 items-center rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold tracking-wide uppercase text-amber-700 dark:text-amber-300">
            {t('leaderboardPage.heroYou')}
          </span>
        </div>

        {/* Tier */}
        <div className="hidden shrink-0 sm:block">
          <RankBadge tier={entry.tier} />
        </div>

        {/* Top 10 Total Score */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span className="font-semibold text-amber-400 tabular-nums">
            {entry.top10TotalScore.toLocaleString()}
          </span>
          <ChevronDown
            className={cn(
              'size-4 text-foreground/60 transition-transform duration-200',
              expanded && 'rotate-180',
            )}
            aria-hidden
          />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-amber-500/30 bg-page px-2 py-4 sm:px-4 sm:py-6">
          <PlayerGames matches={expandedMatches} isLoading={isLoadingMatches} />
        </div>
      )}
    </div>
  )
}
