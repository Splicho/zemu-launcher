import {
  createColumnHelper,
  type ColumnDef,
} from '@tanstack/react-table'
import type { LeaderboardEntry, LeaderboardTier } from '@/lib/leaderboard'
import { RankBadge } from '@/components/leaderboard/rank-badge'
import { CountryFlagThumb } from '@/components/leaderboard/country-flag-thumb'
import { ClantagBadge } from '@/components/leaderboard/clantag-badge'
import { SortableHeader } from '@/components/leaderboard/sortable-header'

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`
}

function formatNumber(value: number): string {
  return value.toLocaleString()
}

function formatRatio(value: number): string {
  return value.toFixed(1)
}

const columnHelper = createColumnHelper<LeaderboardEntry>()

export const leaderboardColumns: Array<ColumnDef<LeaderboardEntry>> = columnHelper.columns([
  columnHelper.accessor('position', {
    id: 'position',
    header: ({ column }) => (
      <SortableHeader
        label="#"
        align="center"
        sorted={column.getIsSorted()}
        onToggle={column.getToggleSortingHandler() ?? undefined}
      />
    ),
    cell: ({ getValue }) => (
      <div className="text-center font-mono font-semibold tabular-nums">
        #{getValue<number>()}
      </div>
    ),
  }),
  columnHelper.accessor('name', {
    id: 'name',
    header: ({ column }) => (
      <SortableHeader
        label="Name"
        sorted={column.getIsSorted()}
        onToggle={column.getToggleSortingHandler() ?? undefined}
      />
    ),
    cell: ({ getValue, row }) => {
      const name = getValue<string>()
      const country = row.original.country ?? null
      const meta = row.getAllCells()[0]?.getContext().table.options.meta as
        | { clanTags?: Record<string, { clanSlug: string; clanName: string; clantag: string }> }
        | undefined
      const key = name.toLowerCase()
      const tag = meta?.clanTags?.[key] ?? null
      return (
        <div className="flex items-center gap-2">
          <span className="font-medium">{name}</span>
          {country && <CountryFlagThumb code={country} size={16} className="shrink-0" />}
          {tag && (
            <ClantagBadge
              tag={tag.clantag}
              href={`https://zemu.uk/clans/${tag.clanSlug}`}
              size="sm"
              className="shrink-0"
            />
          )}
        </div>
      )
    },
  }),
  columnHelper.accessor('tier', {
    id: 'tier',
    header: ({ column }) => (
      <SortableHeader
        label="Tier"
        sorted={column.getIsSorted()}
        onToggle={column.getToggleSortingHandler() ?? undefined}
      />
    ),
    cell: ({ getValue }) => <RankBadge tier={getValue<LeaderboardTier>()} />,
  }),
  columnHelper.accessor('top10TotalScore', {
    id: 'top10TotalScore',
    header: ({ column }) => (
      <SortableHeader
        label="Top 10 Total Score"
        align="center"
        sorted={column.getIsSorted()}
        onToggle={column.getToggleSortingHandler() ?? undefined}
        className="text-amber-400 hover:text-amber-300"
      />
    ),
    cell: ({ getValue }) => (
      <div className="text-center font-semibold text-amber-400 tabular-nums">
        {formatNumber(getValue<number>())}
      </div>
    ),
  }),
  columnHelper.accessor('topMatchKills', {
    id: 'topMatchKills',
    header: ({ column }) => (
      <SortableHeader
        label="Top Match Kills"
        align="center"
        sorted={column.getIsSorted()}
        onToggle={column.getToggleSortingHandler() ?? undefined}
      />
    ),
    cell: ({ getValue }) => (
      <div className="text-center tabular-nums">{formatNumber(getValue<number>())}</div>
    ),
  }),
  columnHelper.accessor('winRate', {
    id: 'winRate',
    header: ({ column }) => (
      <SortableHeader
        label="Win Rate"
        align="center"
        sorted={column.getIsSorted()}
        onToggle={column.getToggleSortingHandler() ?? undefined}
      />
    ),
    cell: ({ getValue }) => (
      <div className="relative flex h-8 w-full min-w-[64px] items-center justify-center">
        <img
          src="/images/assets/backsmudge.png"
          alt=""
          aria-hidden
          width={64}
          height={32}
          className="pointer-events-none absolute inset-0 m-auto h-8 w-full max-w-[120px] object-contain"
        />
        <div className="relative z-10 tabular-nums">{formatPercent(getValue<number>())}</div>
      </div>
    ),
  }),
  columnHelper.accessor('killsPerMatch', {
    id: 'killsPerMatch',
    header: ({ column }) => (
      <SortableHeader
        label="K/M"
        align="center"
        sorted={column.getIsSorted()}
        onToggle={column.getToggleSortingHandler() ?? undefined}
      />
    ),
    cell: ({ getValue }) => (
      <div className="relative flex h-8 w-full min-w-[80px] items-center justify-center">
        <img
          src="/images/assets/backsmudge.png"
          alt=""
          aria-hidden
          width={64}
          height={32}
          className="pointer-events-none absolute inset-0 m-auto h-8 w-full max-w-[140px] object-contain"
        />
        <img
          src="/images/assets/skull.png"
          alt=""
          aria-hidden
          width={20}
          height={20}
          className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-5 w-auto -translate-x-[34px] -translate-y-1/2 object-contain mr-1"
        />
        <div className="relative z-20 tabular-nums">{formatRatio(getValue<number>())}</div>
      </div>
    ),
  }),
])
