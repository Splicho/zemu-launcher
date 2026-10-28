'use client'

import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LeaderboardEntry } from '@/lib/leaderboard'
import { RankBadge } from '@/components/leaderboard/rank-badge'
import { DisplayName } from '@/components/player/display-name'
import { PlayerGames } from '@/components/leaderboard/player-games'

/** Pill art for the "YOU" badge (37×15, drawn slightly larger). */
const YOU_BADGE = '/icon/leaderboard-you-badge.png'

/**
 * Standalone "YOU" row, rendered between the filter bar and the
 * leaderboard table. Compact summary (Position · Name · Tier · Top
 * 10 Total Score) with the same amber "you" affordance the
 * previous in-table hero row had, plus click-to-expand to load
 * the signed-in player's top-10 matches.
 *
 * The row stays visible when the user's entry is filtered out of
 * the main table — `dimmed` styles drop opacity to communicate
 * "you'd be filtered out right now", while the position number still
 * reflects the actual standings (not the filtered view).
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

  const handleToggle = useCallback(() => {
    setExpanded((current) => !current)
  }, [])

  const clan = clanTags[entry.name.toLowerCase()] ?? null

  return (
    <div
      className={cn(
        // "You" row palette: deep red surface, brand-red border, bright red
        // text. Overrides the old amber treatment so the row reads as ZEmu
        // rather than a generic warning highlight.
        'overflow-hidden rounded-lg border-2 border-[#a80000] bg-[#4a1818] text-[#e31f1f]',
        'transition-opacity',
        dimmed && 'opacity-60 hover:opacity-90',
      )}
      data-hero-row="true"
    >
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={expanded}
        // No hover state on the row itself: the surface stays the deep red in
        // every state. Weight carries the emphasis instead (see `font-semibold`
        // below), which is cheaper visually than a second red tone.
        className={cn('flex w-full items-center gap-4 px-4 py-3 text-left font-semibold')}
      >
        {/* Position */}
        <div className="flex w-14 shrink-0 flex-col items-center gap-0.5">
          <span className="font-mono font-semibold tabular-nums">#{entry.position}</span>
        </div>

        {/* Name + YOU badge */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <DisplayName
            name={entry.name}
            href={`#/player/${encodeURIComponent(entry.name)}`}
            country={entry.country}
            clan={clan ? { tag: clan.clantag, href: `#/clan/${clan.clanSlug}` } : null}
            royalty={entry.position === 1 && entry.tier === 'royalty'}
            nameClassName="font-semibold hover:underline"
          />
          {/* "YOU" badge — the art is the pill, the label is real text on
              top so it follows the active language. */}
          <span className="relative inline-flex shrink-0 items-center justify-center">
            <img
              src={YOU_BADGE}
              alt=""
              aria-hidden
              draggable={false}
              className="h-[18px] w-[44px]"
            />
            <span className="absolute inset-0 grid place-items-center text-[9px] font-bold uppercase leading-none tracking-[0.08em] text-white">
              {t('leaderboardPage.heroYou')}
            </span>
          </span>
        </div>

        {/* Tier */}
        <div className="hidden shrink-0 sm:block">
          <RankBadge tier={entry.tier} />
        </div>

        {/* Top 10 Total Score */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span className="font-semibold text-[#e31f1f] tabular-nums">{entry.top10TotalScore.toLocaleString()}</span>
          <ChevronDown
            className={cn('size-4 text-[#e31f1f]/70 transition-transform duration-200', expanded && 'rotate-180')}
            aria-hidden
          />
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="hero-matches"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="overflow-hidden"
          >
            <div className="border-t border-[#a80000]/40 bg-black/25 px-2 py-4 text-[#e31f1f] sm:px-4 sm:py-6">
              <PlayerGames matches={entry.topMatches ?? []} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
