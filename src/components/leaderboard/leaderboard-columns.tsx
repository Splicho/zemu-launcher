import {
  type ColumnDef,
  type HeaderContext,
  flexRender,
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

// TanStack-Table v9 constrains the first generic of `ColumnDef` /
// `HeaderContext` / `CellContext` to a `TableFeatures` shape that
// requires a registry of feature maps (sorting, filtering, etc.). The
// table-core installed in this repo (`9.2.4`) doesn't publish a
// feature-set alias our consumers can plug in, so the type system
// can't narrow the column/cell/header generic on its own. We use
// `any` for the slot and let the runtime + `flexRender` carry the
// contract instead — same approach used by every downstream app
// shipping TanStack v9 with the stock registry.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Features = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Col = ColumnDef<Features, LeaderboardEntry, any>

function getSortHelpers(column: unknown): {
  getIsSorted: () => false | 'asc' | 'desc'
  getToggleSortingHandler: () => undefined | ((event: unknown) => void)
} {
  return column as {
    getIsSorted: () => false | 'asc' | 'desc'
    getToggleSortingHandler: () => undefined | ((event: unknown) => void)
  }
}

function sortableHeader(
  label: string,
  opts: {
    align?: 'left' | 'center' | 'right'
    className?: string
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: HeaderContext<any, LeaderboardEntry, any>,
) {
  const col = getSortHelpers(ctx.column)
  return (
    <SortableHeader
      label={label}
      align={opts.align}
      sorted={col.getIsSorted()}
      onToggle={col.getToggleSortingHandler() ?? undefined}
      className={opts.className}
    />
  )
}

export const leaderboardColumns: Col[] = [
  {
    id: 'position',
    accessorKey: 'position',
    header: (ctx) => sortableHeader('#', { align: 'center' }, ctx),
    cell: (ctx) => (
      <div className="text-center font-mono font-semibold tabular-nums">
        #{ctx.getValue() as number}
      </div>
    ),
  },
  {
    id: 'name',
    accessorKey: 'name',
    header: (ctx) => sortableHeader('Name', {}, ctx),
    cell: (ctx) => {
      const name = ctx.getValue() as string
      const country = ctx.row.original.country ?? null
      const meta = ctx.table.options.meta as
        | {
            clanTags?: Record<
              string,
              { clanSlug: string; clanName: string; clantag: string }
            >
          }
        | undefined
      const key = name.toLowerCase()
      const tag = meta?.clanTags?.[key] ?? null
      return (
        <div className="flex items-center gap-2">
          <a
            href={`#/player/${encodeURIComponent(name)}`}
            className="font-medium hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {name}
          </a>
          {country && (
            <CountryFlagThumb code={country} size={16} className="shrink-0" />
          )}
          {tag && (
            <ClantagBadge
              tag={tag.clantag}
              href={`#/clan/${tag.clanSlug}`}
              size="sm"
              className="shrink-0"
            />
          )}
        </div>
      )
    },
  },
  {
    id: 'tier',
    accessorKey: 'tier',
    header: (ctx) => sortableHeader('Tier', {}, ctx),
    cell: (ctx) => <RankBadge tier={ctx.getValue() as LeaderboardTier} />,
  },
  {
    id: 'top10TotalScore',
    accessorKey: 'top10TotalScore',
    header: (ctx) =>
      sortableHeader(
        'Top 10 Total Score',
        { align: 'center', className: 'text-amber-400 hover:text-amber-300' },
        ctx,
      ),
    cell: (ctx) => (
      <div className="text-center tabular-nums">
        {formatNumber(ctx.getValue() as number)}
      </div>
    ),
  },
  {
    id: 'topMatchKills',
    accessorKey: 'topMatchKills',
    header: (ctx) =>
      sortableHeader('Top Match Kills', { align: 'center' }, ctx),
    cell: (ctx) => (
      <div className="text-center tabular-nums">
        {formatNumber(ctx.getValue() as number)}
      </div>
    ),
  },
  {
    id: 'winRate',
    accessorKey: 'winRate',
    header: (ctx) => sortableHeader('Win Rate', { align: 'center' }, ctx),
    cell: (ctx) => {
      const value = ctx.getValue() as number
      return (
        <div className="relative flex h-8 w-full min-w-[64px] items-center justify-center">
          <img
            src="/images/assets/backsmudge.png"
            alt=""
            aria-hidden
            width={64}
            height={32}
            className="pointer-events-none absolute inset-0 m-auto h-8 w-full max-w-[120px] object-contain"
          />
          <div className="relative z-10 tabular-nums">{formatPercent(value)}</div>
        </div>
      )
    },
  },
  {
    id: 'killsPerMatch',
    accessorKey: 'killsPerMatch',
    header: (ctx) => sortableHeader('K/M', { align: 'center' }, ctx),
    cell: (ctx) => {
      const value = ctx.getValue() as number
      return (
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
            className="pointer-events-none absolute top-1/2 left-1/2 z-10 h-5 w-auto -translate-x-[34px] -translate-y-1/2 object-contain mr-1"
          />
          <div className="relative z-20 tabular-nums">{formatRatio(value)}</div>
        </div>
      )
    },
  },
]

export { flexRender }
