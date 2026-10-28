'use client'

import { useCallback, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  type ColumnDef,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
  flexRender,
} from '@tanstack/react-table'

import { Skeleton } from '@/components/ui/skeleton'
import type { LeaderboardEntry } from '@/lib/leaderboard'
import { PlayerGames } from '@/components/leaderboard/player-games'
import { leaderboardColumns } from '@/components/leaderboard/leaderboard-columns'
import { cn } from '@/lib/utils'

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() })

/**
 * Shared column track for the header and every row.
 *
 * `#`, name (the only flexible column), tier, top-10 score, top-match kills,
 * win rate, K/M. Both the header strip and the body rows use it, which is
 * what keeps the columns aligned after dropping the `<table>` semantics.
 */
const GRID_COLUMNS =
  'grid grid-cols-[4rem_minmax(0,1fr)_9rem_11rem_10rem_8rem_7.5rem_1.5rem] items-center gap-4'

interface LeaderboardTableProps {
  entries: readonly LeaderboardEntry[]
  // TanStack-Table v9 generics â€” see leaderboard-columns.tsx for why
  // we use `any` for the features slot. The runtime contract still
  // flows through `useTable`, so the column array stays array-shaped.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns?: Array<ColumnDef<any, LeaderboardEntry, any>>
  isLoading?: boolean
  clanTags?: Record<string, { clanSlug: string; clanName: string; clantag: string }>
}

/**
 * Leaderboard list â€” divs, not a `<table>`.
 *
 * Every row is its own rounded card, separated by a gap, with the column
 * header as a standalone rounded strip above them. Sorting and expansion
 * still go through TanStack; only the markup changed (a `<table>` can't put
 * space between rows without border-spacing shenanigans, and its cells
 * can't carry their own radius).
 *
 * Rows are `role="button"` divs rather than `<button>`s because the name
 * cell contains a link â€” an interactive element inside a button is invalid
 * HTML and swallows keyboard activation.
 */
export default function LeaderboardTable({
  entries,
  columns = leaderboardColumns,
  isLoading = false,
  clanTags = {},
}: LeaderboardTableProps) {
  const { t } = useTranslation()

  // Expansion is purely local: every row already carries its own
  // `topMatches` (both boards embed them), so opening a row never
  // fetches anything.
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [sorting, setSorting] = useState([{ id: 'top10TotalScore', desc: true }])

  const tableData = useMemo(
    () => entries as unknown as Array<LeaderboardEntry & { __id?: string }>,
    [entries],
  )

  const handleRowClick = useCallback((rowId: string) => {
    setExpandedRow(current => (current === rowId ? null : rowId))
  }, [])

  const table = useTable({
    key: 'leaderboard-table',
    features,
    data: tableData,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: row => {
      // Key by player name (unique on both boards) instead of the page
      // index so an expanded row survives sorting and pagination.
      const r = row as LeaderboardEntry & { __id?: string }
      return r.__id ?? `player:${r.name}`
    },
    meta: { clanTags },
  })

  const rows = table.getRowModel().rows
  const headerGroup = table.getHeaderGroups()[0]

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {/* Column header â€” standalone rounded strip. */}
      <div
        className={cn(
          GRID_COLUMNS,
          'rounded-lg border border-foreground/10 bg-muted px-4 py-2 text-[11px] tracking-wide whitespace-nowrap text-foreground/70 uppercase',
        )}
      >
        {headerGroup.headers.map(header => (
          <div key={header.id} className="min-w-0">
            {header.isPlaceholder
              ? null
              : flexRender(header.column.columnDef.header, header.getContext())}
          </div>
        ))}
      </div>

      {isLoading ? (
        Array.from({ length: 8 }).map((_, index) => (
          <div key={`skeleton-${index}`} className={cn(GRID_COLUMNS, 'rounded-lg border border-foreground/10 bg-muted px-4 py-3')}>
            {columns.map((_, columnIndex) => (
              <div key={columnIndex} className="min-w-0">
                <Skeleton className="h-6 w-full" />
              </div>
            ))}
            <div />
          </div>
        ))
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-foreground/10 bg-muted px-4 py-12 text-center text-sm text-foreground/60">
          {t('leaderboardPage.empty')}
        </div>
      ) : (
        rows.map(row => {
          const entry = row.original as LeaderboardEntry
          const isExpanded = expandedRow === row.id

          return (
            <div key={row.id} className="overflow-hidden rounded-lg border border-foreground/10 bg-muted">
              <div
                role="button"
                tabIndex={0}
                aria-expanded={isExpanded}
                onClick={() => handleRowClick(row.id)}
                onKeyDown={event => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  handleRowClick(row.id)
                }}
                className={cn(
                  GRID_COLUMNS,
                  'w-full cursor-pointer px-4 py-2.5 text-left transition-colors hover:bg-[#333333]',
                  'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none',
                )}
              >
                {row.getAllCells().map(cell => (
                  <div key={cell.id} className="min-w-0">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                ))}

                {/* Expand affordance — rotates with the panel state. */}
                <div className="flex justify-end">
                  <ChevronDown
                    aria-hidden
                    className={cn(
                      'size-4 text-foreground/50 transition-transform duration-200',
                      isExpanded && 'rotate-180',
                    )}
                  />
                </div>
              </div>

              <AnimatePresence initial={false}>
                {isExpanded && (
                  <motion.div
                    key="matches"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
                    className="overflow-hidden"
                  >
                    <div className="border-t border-foreground/10 bg-[#232323] px-4 py-4 text-foreground">
                      <PlayerGames matches={entry.topMatches ?? []} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })
      )}
    </div>
  )
}




