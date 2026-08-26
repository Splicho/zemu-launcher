import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
import { fetchTopLeaderboard, type LeaderboardTier } from '@/lib/leaderboard'

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
  const assets = RANK_ASSETS[tier]
  return (
    <div className="flex items-center gap-1.5">
      <img
        src={assets.medal}
        alt={tier}
        className="h-5 w-5 object-contain"
      />
      <span className="text-xs font-semibold uppercase">{tier}</span>
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
  const [tierFilter, setTierFilter] = useState('all')
  const [region, setRegion] = useState('EU')
  const [teamMode, setTeamMode] = useState('Solo')

  const { data: entries, error } = useQuery({
    queryKey: ['leaderboard', { region, teamMode, tierFilter }],
    queryFn: () => fetchTopLeaderboard({ limit: 5, tier: tierFilter }),
  })

  // Hard cap so the card always renders at most 5 rows even if the API
  // returns more, or the tier filter is later relaxed client-side.
  const visibleEntries = entries?.slice(0, 5)

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 px-6">
        <CardTitle className="uppercase tracking-wide">Top 5 Players</CardTitle>
        <div className="flex flex-wrap items-center gap-2">          <Select value={tierFilter} onValueChange={setTierFilter}>
            <SelectTrigger className="w-28 h-7">
              <SelectValue placeholder="Tier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tiers</SelectItem>
              <SelectItem value="bronze">Bronze</SelectItem>
              <SelectItem value="silver">Silver</SelectItem>
              <SelectItem value="gold">Gold</SelectItem>
              <SelectItem value="platinum">Platinum</SelectItem>
              <SelectItem value="diamond">Diamond</SelectItem>
              <SelectItem value="master">Master</SelectItem>
            </SelectContent>
          </Select>

          <Select value={region} onValueChange={setRegion}>
            <SelectTrigger className="w-20 h-7">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="EU">EU</SelectItem>
              <SelectItem value="NA" disabled>NA (Soon)</SelectItem>
              <SelectItem value="ASIA" disabled>ASIA (Soon)</SelectItem>
            </SelectContent>
          </Select>

          <Select value={teamMode} onValueChange={setTeamMode}>
            <SelectTrigger className="w-20 h-7">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Solo">Solo</SelectItem>
              <SelectItem value="Duo">Duo</SelectItem>
              <SelectItem value="Fives">Fives</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-12 text-center tracking-wide uppercase text-foreground/70">#</TableHead>
              <TableHead className="tracking-wide uppercase text-foreground/70">Name</TableHead>
              <TableHead className="w-20 tracking-wide uppercase text-foreground/70">Tier</TableHead>
              <TableHead className="text-right tracking-wide uppercase text-foreground/70">
                <span className="text-amber-400">Total Score</span>
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

            {entries === undefined && !error && (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            )}

            {visibleEntries && visibleEntries.length === 0 && !error && (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">
                  No players found.
                </TableCell>
              </TableRow>
            )}

            {visibleEntries?.map((entry) => (
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
