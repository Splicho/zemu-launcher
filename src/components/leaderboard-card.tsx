import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useHashRouter } from '@/hooks/use-hash'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card'
import {
  TIER_VALUES,
  type LeaderboardTier,
  type LeaderboardEntry,
} from '@/lib/leaderboard'
import { useLeaderboardEntries } from '@/hooks/use-leaderboard'

const RANK_ASSETS: Record<LeaderboardTier, { smudge: string; medal: string }> = {
  bronze: { smudge: '/images/assets/ranks/bronze/smudge.png', medal: '/images/assets/ranks/bronze/medal.png' },
  silver: { smudge: '/images/assets/ranks/silver/smudge.png', medal: '/images/assets/ranks/silver/medal.png' },
  gold: { smudge: '/images/assets/ranks/gold/smudge.png', medal: '/images/assets/ranks/gold/medal.png' },
  platinum: { smudge: '/images/assets/ranks/platinum/smudge.png', medal: '/images/assets/ranks/platinum/medal.png' },
  diamond: { smudge: '/images/assets/ranks/diamond/smudge.png', medal: '/images/assets/ranks/diamond/medal.png' },
  master: { smudge: '/images/assets/ranks/master/smudge.png', medal: '/images/assets/ranks/master/medal.png' },
}

function formatNumber(value: number): string {
  return value.toLocaleString()
}

function RankBadge({ tier }: { tier: LeaderboardTier }) {
  const { t } = useTranslation()
  const assets = RANK_ASSETS[tier]
  return (
    <div className="flex items-center gap-1.5">
      <img
        src={assets.medal}
        alt={t(`leaderboard.${tier}`)}
        className="h-5 w-5 object-contain"
      />
      <span className="text-xs font-semibold uppercase">{t(`leaderboard.${tier}`)}</span>
    </div>
  )
}

function SkeletonRow() {
  return (
    <TableRow>
      <TableCell><div className="h-8 w-8 mx-auto bg-muted/40 animate-pulse rounded" /></TableCell>
      <TableCell><div className="h-8 w-32 bg-muted/40 animate-pulse rounded" /></TableCell>
      <TableCell><div className="h-8 w-20 bg-muted/40 animate-pulse rounded" /></TableCell>
      <TableCell><div className="h-8 w-24 ml-auto bg-muted/40 animate-pulse rounded" /></TableCell>
    </TableRow>
  )
}

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

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 px-6">
        <CardTitle className="uppercase tracking-wide">{t('leaderboard.topPlayers')}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">          <Select value={tierFilter} onValueChange={setTierFilter}>
            <SelectTrigger className="w-28 h-7">
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
            <SelectTrigger className="w-20 h-7">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="EU">{t('leaderboard.regionEU')}</SelectItem>
              <SelectItem value="NA" disabled>{t('leaderboard.regionNA')}</SelectItem>
              <SelectItem value="ASIA" disabled>{t('leaderboard.regionAsia')}</SelectItem>
            </SelectContent>
          </Select>

          <Select value={teamMode} onValueChange={setTeamMode}>
            <SelectTrigger className="w-20 h-7">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Solo">{t('leaderboard.modeSolo')}</SelectItem>
              <SelectItem value="Duo">{t('leaderboard.modeDuo')}</SelectItem>
              <SelectItem value="Fives">{t('leaderboard.modeFives')}</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="gradient"
            className="group/view-full"
            onClick={() => navigate('/leaderboard')}
          >
            {t('leaderboard.viewFull')}
            <ArrowRight className="size-4 transition-transform duration-200 ease-out group-hover/view-full:translate-x-0.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-12 text-center tracking-wide uppercase text-foreground/70">#</TableHead>
              <TableHead className="tracking-wide uppercase text-foreground/70">{t('leaderboard.colName')}</TableHead>
              <TableHead className="w-20 tracking-wide uppercase text-foreground/70">{t('leaderboard.colTier')}</TableHead>
              <TableHead className="text-right tracking-wide uppercase text-foreground/70">
                <span className="text-amber-400">{t('leaderboard.colTotalScore')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {error && (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">
                  {error.message}
                </TableCell>
              </TableRow>
            )}

            {isInitialLoading && (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            )}

            {!isInitialLoading && visibleEntries.length === 0 && !error && (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">
                  {t('leaderboard.noPlayersFound')}
                </TableCell>
              </TableRow>
            )}

            {visibleEntries.map((entry) => (
              <TableRow
                key={entry.position}
                className="cursor-pointer hover:bg-foreground/5"
              >
                <TableCell className="text-center">
                  <span className="font-mono font-semibold tabular-nums">
                    #{entry.position}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{entry.name}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <RankBadge tier={entry.tier} />
                </TableCell>
                <TableCell className="text-right">
                  <span className="font-semibold text-amber-400 tabular-nums">
                    {formatNumber(entry.top10TotalScore)}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
