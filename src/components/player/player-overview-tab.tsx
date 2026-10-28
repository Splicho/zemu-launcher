import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { RoyaltyAura } from '@/components/player/royalty-shader'
import type { PlayerMatchStats, PlayerRank, PlayerRecentMatch } from '@/lib/player-stats'
import { cn } from '@/lib/utils'

/**
 * Overview tab: totals from Ghost's public match-stats API plus a
 * kills-per-match chart built from the player's most recent matches.
 *
 * Ported from the website's `player-overview-tab.tsx`. Every number is real;
 * a player with no recorded matches gets em dashes and an empty-state line
 * instead of fabricated data. Layout mirrors a Steam profile: wide column for
 * the stat cards and chart, narrow right-hand sidebar for the rank card (or
 * the ban notice when the account is banned).
 */
const DAY_MS = 24 * 60 * 60 * 1000

/** Day windows available on the kills-per-match card. */
const CHART_RANGES = [
  { key: '7d', label: '7d', days: 7 },
  { key: '14d', label: '14d', days: 14 },
  { key: '30d', label: '30d', days: 30 },
] as const

type ChartRange = (typeof CHART_RANGES)[number]['key']

const TIER_LABEL: Record<string, string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
  diamond: 'Diamond',
  royalty: 'Royalty',
}

const INTEGER_FORMAT = new Intl.NumberFormat('en-US')
const PERCENT_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
const PLACEMENT_FORMAT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

/** UTC so the ban date reads the same everywhere. */
const BAN_DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

const EM_DASH = '—'

interface PlayerOverviewTabProps {
  matchStats: PlayerMatchStats | null
  /** Newest first; the chart reverses the filtered slice into chronological order. */
  recentMatches: PlayerRecentMatch[]
  /** Current season rank, or `null` when the player isn't on the board. */
  rank: PlayerRank | null
  banned: boolean
  bannedAt: string | null
  bannedReason: string | null
  /** Clock snapshot from the stats fetch; drives the chart's day cutoffs. */
  now: number
}

export function PlayerOverviewTab({
  matchStats,
  recentMatches,
  rank,
  banned,
  bannedAt,
  bannedReason,
  now,
}: PlayerOverviewTabProps) {
  const { t } = useTranslation()
  const [range, setRange] = useState<ChartRange>('7d')

  const total = matchStats?.total ?? null

  const statCards = [
    {
      label: t('player.stats.matches'),
      value: total ? INTEGER_FORMAT.format(total.matches) : EM_DASH,
    },
    {
      label: t('player.stats.winRate'),
      value: total && total.matches > 0 ? `${PERCENT_FORMAT.format(total.winRate * 100)}%` : EM_DASH,
    },
    {
      label: t('player.stats.kills'),
      value: total ? INTEGER_FORMAT.format(total.kills) : EM_DASH,
    },
    {
      label: t('player.stats.avgPlacement'),
      value:
        total?.averagePlacement != null
          ? `#${PLACEMENT_FORMAT.format(total.averagePlacement)}`
          : EM_DASH,
    },
  ]

  const rangeDays = CHART_RANGES.find((option) => option.key === range)?.days ?? 7
  const chartData = useMemo(() => {
    const cutoff = now - rangeDays * DAY_MS
    return recentMatches
      .filter((match) => match.startedAt >= cutoff)
      .slice()
      .reverse()
      .map((match, index) => ({ match: index + 1, kills: match.kills }))
  }, [recentMatches, rangeDays, now])

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="order-1 grid grid-cols-2 gap-6 sm:grid-cols-4 lg:col-start-1 lg:row-start-1">
        {statCards.map((stat) => (
          <Card key={stat.label} className="h-full border-border/40 bg-transparent py-0">
            <div className="m-1 flex flex-1 flex-col rounded-2xl bg-accent">
              <CardContent className="flex flex-1 flex-col justify-between gap-6 p-4">
                <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {stat.label}
                </span>
                <span
                  className={cn(
                    'text-2xl font-semibold tabular-nums',
                    stat.value === EM_DASH ? 'text-muted-foreground' : 'text-foreground',
                  )}
                >
                  {stat.value}
                </span>
              </CardContent>
            </div>
          </Card>
        ))}
      </div>

      <aside className="order-3 lg:order-none lg:col-start-2 lg:row-start-1">
        {banned ? (
          <BansCard bannedAt={bannedAt} bannedReason={bannedReason} />
        ) : (
          <RankCard rank={rank} />
        )}
      </aside>

      <div className="order-2 lg:order-none lg:col-start-1 lg:row-start-2">
        <Card className="border-border/40 bg-transparent py-0">
          <div className="m-1 rounded-2xl bg-accent">
            <CardContent className="p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xl text-foreground">{t('player.stats.killsPerMatch')}</h3>
                  <p className="text-xs text-muted-foreground">
                    {t('player.stats.rangeSummary', {
                      count: chartData.length,
                      days: rangeDays,
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-1 rounded-md border border-border/60 p-0.5">
                  {CHART_RANGES.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setRange(option.key)}
                      aria-pressed={range === option.key}
                      className={cn(
                        'rounded px-2 py-1 text-xs tabular-nums transition-colors',
                        range === option.key
                          ? 'bg-muted text-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {chartData.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  {recentMatches.length === 0
                    ? t('player.stats.noMatches')
                    : t('player.stats.noMatchesInRange', { days: rangeDays })}
                </p>
              ) : (
                <div className="h-60 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                      <defs>
                        <linearGradient id="player-kills-fill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#7a0101" stopOpacity={0.55} />
                          <stop offset="100%" stopColor="#7a0101" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="currentColor" strokeOpacity={0.08} vertical={false} />
                      <XAxis
                        dataKey="match"
                        tickFormatter={(value: number) => `#${value}`}
                        stroke="currentColor"
                        strokeOpacity={0.35}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis
                        stroke="currentColor"
                        strokeOpacity={0.35}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 11 }}
                        allowDecimals={false}
                      />
                      <Tooltip
                        cursor={{ stroke: 'currentColor', strokeOpacity: 0.2 }}
                        contentStyle={{
                          background: 'var(--popover)',
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                        labelFormatter={(label) =>
                          t('player.stats.matchNumber', { number: String(label) })
                        }
                        formatter={(value) => [String(value), t('player.stats.kills')]}
                      />
                      <Area
                        type="monotone"
                        dataKey="kills"
                        stroke="#9c0b0b"
                        strokeWidth={1.5}
                        fill="url(#player-kills-fill)"
                        dot={false}
                        activeDot={{ r: 3, fill: '#9c0b0b' }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </div>
        </Card>
      </div>
    </div>
  )
}

/** Rank card for the sidebar — tier banner art plus the Royalty aura. */
function RankCard({ rank }: { rank: PlayerRank | null }) {
  const { t } = useTranslation()

  return (
    <Card className="h-full border-border/40 bg-transparent py-0">
      <div className="m-1 flex flex-1 flex-col overflow-hidden rounded-2xl bg-accent p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('player.stats.rank')}
          </h3>
          {rank ? (
            <Badge variant="outline" className="rounded-lg tabular-nums">
              #{rank.position}
            </Badge>
          ) : null}
        </div>
        <div className="relative flex flex-1 items-center justify-center py-3">
          {rank ? (
            <span className="relative isolate flex w-fit items-center justify-center">
              {rank.tier === 'royalty' ? <RoyaltyAura /> : null}
              <img
                src={`/${rank.tier}.png`}
                alt={`${TIER_LABEL[rank.tier] ?? rank.tier} rank`}
                width={440}
                height={100}
                className="relative z-10 h-auto w-40"
              />
            </span>
          ) : (
            <p className="text-sm text-muted-foreground">{t('player.stats.notRanked')}</p>
          )}
        </div>
      </div>
    </Card>
  )
}

/** Active-ban notice for the sidebar. Only rendered for banned accounts. */
function BansCard({
  bannedAt,
  bannedReason,
}: {
  bannedAt: string | null
  bannedReason: string | null
}) {
  const { t } = useTranslation()

  return (
    <Card className="h-full border-destructive/40 bg-transparent py-0">
      <div className="m-1 flex flex-1 flex-col gap-8 rounded-2xl bg-destructive/10 p-4">
        <h3 className="text-xs font-medium tracking-wide text-destructive uppercase">
          {t('player.stats.bans')}
        </h3>
        <div>
          <p className="line-clamp-3 text-sm text-foreground" title={bannedReason ?? undefined}>
            {bannedReason ?? t('player.stats.noReason')}
          </p>
          {bannedAt ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {t('player.stats.bannedOn', { date: BAN_DATE_FORMAT.format(new Date(bannedAt)) })}
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  )
}
