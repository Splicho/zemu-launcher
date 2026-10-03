import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useHashRouter } from '@/hooks/use-hash'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  TIER_VALUES,
  type LeaderboardTier,
  type LeaderboardEntry,
} from '@/lib/leaderboard'
import { useLeaderboardEntries } from '@/hooks/use-leaderboard'
import { cn } from '@/lib/utils'

const RANK_ASSETS: Record<LeaderboardTier, { smudge: string; medal: string }> = {
  bronze: { smudge: '/images/assets/ranks/bronze/smudge.png', medal: '/images/assets/ranks/bronze/medal.png' },
  silver: { smudge: '/images/assets/ranks/silver/smudge.png', medal: '/images/assets/ranks/silver/medal.png' },
  gold: { smudge: '/images/assets/ranks/gold/smudge.png', medal: '/images/assets/ranks/gold/medal.png' },
  platinum: { smudge: '/images/assets/ranks/platinum/smudge.png', medal: '/images/assets/ranks/platinum/medal.png' },
  diamond: { smudge: '/images/assets/ranks/diamond/smudge.png', medal: '/images/assets/ranks/diamond/medal.png' },
  master: { smudge: '/images/assets/ranks/master/smudge.png', medal: '/images/assets/ranks/master/medal.png' },
}

// The `master` tier is shown to players as "Royalty".
const tierLabelKey = (tier: LeaderboardTier) =>
  tier === 'master' ? 'leaderboard.royalty' : `leaderboard.${tier}`

const playerHref = (name: string) => `#/player/${encodeURIComponent(name)}`

function formatNumber(value: number): string {
  return value.toLocaleString()
}

/**
 * Home-screen top 5. Being up here should feel like something:
 * #1 gets a champion panel (giant rank numeral painted over its
 * tier's smudge, big medal, headline stats), and #2–#5 stack beside
 * it as rows with their own tier smudge behind the rank. Every
 * player links to their profile.
 */
export function LeaderboardCard() {
  const { t } = useTranslation()
  const { navigate } = useHashRouter()
  const [tierFilter, setTierFilterRaw] = useState<LeaderboardTier | 'all'>('all')
  const setTierFilter = (value: string) => {
    if (value === 'all' || TIER_VALUES.includes(value as LeaderboardTier)) {
      setTierFilterRaw(value as LeaderboardTier | 'all')
    }
  }
  const [region, setRegion] = useState('EU')
  const [teamMode, setTeamMode] = useState('Solo')

  // Share the `['leaderboard', 'entries']` cache with the dedicated
  // leaderboard page. The page hits the same key, so navigating
  // straight from this card into the full table renders the rows
  // instantly without a second fetch + skeleton flash.
  const { data: entries, error } = useLeaderboardEntries()

  // Sort by Total Score, take the top 5, and apply the tier filter
  // client-side. The underlying query returns the full standings in
  // server order, so we re-rank here for the card. Re-running the
  // sort + filter is cheap (the page already does the same thing
  // over the same array) and keeps the home card consistent with
  // the leaderboard page's first row.
  const visibleEntries = useMemo<LeaderboardEntry[]>(() => {
    if (!entries) return []
    const filtered = tierFilter === 'all'
      ? entries
      : entries.filter(e => e.tier === tierFilter)
    const sorted = [...filtered].sort(
      (a, b) => b.top10TotalScore - a.top10TotalScore,
    )
    return sorted.slice(0, 5).map((entry, index) => ({
      ...entry,
      position: index + 1,
    }))
  }, [entries, tierFilter])

  const isInitialLoading = entries === undefined && !error
  const [champion, ...chasers] = visibleEntries

  return (
    <section aria-labelledby="home-top-players" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="home-top-players" className="text-2xl font-bold tracking-tight">
          {t('leaderboard.topPlayers')}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={tierFilter} onValueChange={setTierFilter}>
            <SelectTrigger className="h-8 w-28">
              <SelectValue placeholder="Tier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('leaderboard.allTiers')}</SelectItem>
              <SelectItem value="bronze">{t('leaderboard.bronze')}</SelectItem>
              <SelectItem value="silver">{t('leaderboard.silver')}</SelectItem>
              <SelectItem value="gold">{t('leaderboard.gold')}</SelectItem>
              <SelectItem value="platinum">{t('leaderboard.platinum')}</SelectItem>
              <SelectItem value="diamond">{t('leaderboard.diamond')}</SelectItem>
              <SelectItem value="master">{t('leaderboard.royalty')}</SelectItem>
            </SelectContent>
          </Select>

          <Select value={region} onValueChange={setRegion}>
            <SelectTrigger className="h-8 w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="EU">{t('leaderboard.regionEU')}</SelectItem>
              <SelectItem value="NA" disabled>{t('leaderboard.regionNA')}</SelectItem>
              <SelectItem value="ASIA" disabled>{t('leaderboard.regionAsia')}</SelectItem>
            </SelectContent>
          </Select>

          <Select value={teamMode} onValueChange={setTeamMode}>
            <SelectTrigger className="h-8 w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Solo">{t('leaderboard.modeSolo')}</SelectItem>
              <SelectItem value="Duo">{t('leaderboard.modeDuo')}</SelectItem>
              <SelectItem value="Fives">{t('leaderboard.modeFives')}</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="ghost"
            className="group/view-full h-8"
            onClick={() => navigate('/leaderboard')}
          >
            {t('leaderboard.viewFull')}
            <ArrowRight className="size-4 transition-transform duration-200 ease-out group-hover/view-full:translate-x-0.5" />
          </Button>
        </div>
      </div>

      {error ? (
        <p className="py-6 text-sm text-muted-foreground">{error.message}</p>
      ) : isInitialLoading ? (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <Skeleton className="h-72 rounded-xl" />
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[4.25rem] rounded-lg" />
            ))}
          </div>
        </div>
      ) : !champion ? (
        <p className="py-6 text-sm text-muted-foreground">
          {t('leaderboard.noPlayersFound')}
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <ChampionPanel entry={champion} />
          {chasers.length > 0 ? (
            <ol className="flex flex-col gap-2" aria-label={t('leaderboard.topPlayers')}>
              {chasers.map((entry) => (
                <li key={entry.name}>
                  <ChaserRow entry={entry} />
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      )}
    </section>
  )
}

function ChampionPanel({ entry }: { entry: LeaderboardEntry }) {
  const { t } = useTranslation()

  return (
    <a
      href={playerHref(entry.name)}
      className="group/champion relative isolate flex min-h-72 flex-col justify-end overflow-hidden rounded-xl bg-[radial-gradient(ellipse_at_top_left,rgb(251_191_36/0.18)_0%,transparent_60%)] p-6 ring-1 ring-amber-400/30 outline-none transition-shadow hover:ring-amber-400/60 focus-visible:ring-2 focus-visible:ring-amber-400"
    >
      <span
        aria-hidden="true"
        className="absolute top-2 left-6 -z-10 text-[9rem] leading-none font-black tracking-tighter text-white drop-shadow-[0_4px_12px_rgb(0_0_0/0.6)]"
      >
        1
      </span>
      {/* Medal art is as small as 32×32 for some tiers, so it's shown
          near native size over the tier's smudge rather than as a big
          emblem. */}
      <span className="absolute top-5 right-5">
        <TierMark tier={entry.tier} />
      </span>

      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-3xl font-bold tracking-tight text-foreground">
          {entry.name}
        </span>
        <span className="text-lg text-amber-400 tabular-nums">
          {formatNumber(entry.top10TotalScore)}{' '}
          <span className="text-sm text-muted-foreground">
            {t('leaderboard.colTotalScore')}
          </span>
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-white/10 pt-4 text-sm">
        <ChampionStat label={t('leaderboard.statWins')} value={formatNumber(entry.totalWins)} />
        <ChampionStat label={t('leaderboard.statWinRate')} value={`${(entry.winRate * 100).toFixed(1)}%`} />
        <ChampionStat label={t('leaderboard.statKillsPerMatch')} value={entry.killsPerMatch.toFixed(1)} />
      </dl>
    </a>
  )
}

/**
 * Tier medal and name painted over the tier's smudge. Smudges ship at
 * 8:1 (256×32 and up), so the box keeps roughly that ratio instead of
 * stretching them taller.
 */
function TierMark({ tier }: { tier: LeaderboardTier }) {
  const { t } = useTranslation()
  const assets = RANK_ASSETS[tier]
  return (
    <span className="relative flex h-11 min-w-40 items-center justify-start gap-2 py-1.5 pr-5 pl-3 text-sm font-medium text-white">
      <img
        src={assets.smudge}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 size-full object-fill opacity-80"
      />
      <img src={assets.medal} alt="" className="relative size-8 object-contain" />
      <span className="relative drop-shadow-[0_1px_3px_rgb(0_0_0/0.7)]">
        {t(tierLabelKey(tier))}
      </span>
    </span>
  )
}

function ChampionStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className="font-semibold text-foreground tabular-nums">{value}</dd>
    </div>
  )
}

function ChaserRow({ entry }: { entry: LeaderboardEntry }) {
  return (
    <a
      href={playerHref(entry.name)}
      className={cn(
        'group/chaser flex h-[4.25rem] items-center gap-4 rounded-lg bg-white/[0.03] pr-5 outline-none transition-colors',
        'hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <span className="flex w-16 shrink-0 items-center justify-center text-3xl font-black tracking-tighter text-white tabular-nums">
        {entry.position}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">
        {entry.name}
      </span>
      <span className="hidden shrink-0 sm:block">
        <TierMark tier={entry.tier} />
      </span>
      <span className="w-20 shrink-0 text-right font-semibold text-amber-400 tabular-nums">
        {formatNumber(entry.top10TotalScore)}
      </span>
    </a>
  )
}
