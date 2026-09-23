"use client"

import { useState, useCallback, useMemo, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type ColumnDef,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
  flexRender,
} from '@tanstack/react-table'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { LeaderboardEntry } from '@/lib/leaderboard'
import { PlayerGames } from '@/components/leaderboard/player-games'
import { leaderboardColumns } from '@/components/leaderboard/leaderboard-columns'
import { usePlayerTopMatches } from '@/hooks/use-leaderboard'

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() })

interface LeaderboardTableProps {
  entries: readonly LeaderboardEntry[]
  // TanStack-Table v9 generics — see leaderboard-columns.tsx for why
  // we use `any` for the features slot. The runtime contract still
  // flows through `useTable`, so the column array stays array-shaped.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns?: Array<ColumnDef<any, LeaderboardEntry, any>>
  isLoading?: boolean
  filters?: {
    search: string
    tier: string
    country: string
    region: string
    teamMode: string
    pageSize: number
  }
  clanTags?: Record<string, { clanSlug: string; clanName: string; clantag: string }>
  heroRow?: LeaderboardEntry | null
  heroFilteredOut?: boolean
}

const HERO_ROW_ID = '__hero__'

export default function LeaderboardTable({
  entries,
  columns = leaderboardColumns,
  isLoading = false,
  clanTags = {},
  heroRow = null,
  heroFilteredOut = false,
}: LeaderboardTableProps) {
  const { t } = useTranslation()
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null)
  const topMatchesQuery = usePlayerTopMatches(expandedPlayer)
  const expandedMatches = topMatchesQuery.data ?? []
  const isLoadingMatches = topMatchesQuery.isFetching

  const [sorting, setSorting] = useState([{ id: 'top10TotalScore', desc: true }])

  const tableData = useMemo(
    () =>
      heroRow
        ? ([{ ...heroRow, __id: HERO_ROW_ID }] as Array<LeaderboardEntry & { __id?: string }>).concat(
            entries as unknown as Array<LeaderboardEntry & { __id?: string }>,
          )
        : (entries as unknown as Array<LeaderboardEntry & { __id?: string }>),
    [heroRow, entries],
  )

  const handleRowClick = useCallback(
    (rowId: string, playerName: string) => {
      if (expandedRow === rowId) {
        setExpandedRow(null)
        setExpandedPlayer(null)
        return
      }
      setExpandedRow(rowId)
      setExpandedPlayer(playerName)
      void topMatchesQuery.refetch()
    },
    [expandedRow, topMatchesQuery],
  )

  const prefetchMatches = useCallback(
    (playerName: string) => {
      if (expandedRow && expandedPlayer !== playerName) return
      if (expandedPlayer === playerName && topMatchesQuery.data) return
      setExpandedPlayer(playerName)
      void topMatchesQuery.refetch()
    },
    [expandedRow, expandedPlayer, topMatchesQuery],
  )

  const table = useTable({
    key: 'leaderboard-table',
    features,
    data: tableData,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (row, index) => {
      const r = row as LeaderboardEntry & { __id?: string }
      return r.__id ?? `row-${index}`
    },
    meta: { clanTags },
  })

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-foreground/10 bg-background">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map(headerGroup => (
            <TableRow key={headerGroup.id} className="hover:bg-transparent">
              {headerGroup.headers.map(header => (
                <TableHead
                  key={header.id}
                  className="tracking-wide uppercase text-foreground/70"
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <TableRow key={i}>
                {columns.map((_, colIndex) => (
                  <TableCell key={colIndex}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : table.getRowModel().rows.length ? (
            table.getRowModel().rows.map(row => {
              const entry = row.original as LeaderboardEntry
              const isHero = row.id === HERO_ROW_ID
              const isExpanded = expandedRow === row.id

              const heroClasses = isHero
                ? cn(
                    'bg-amber-500/10 hover:bg-amber-500/15',
                    'border-y-2 border-amber-500/60',
                    heroFilteredOut && 'opacity-60 hover:opacity-80',
                  )
                : 'cursor-pointer hover:bg-foreground/5'

              return (
                <Fragment key={row.id}>
                  <TableRow
                    onClick={() => !isHero && handleRowClick(row.id, entry.name)}
                    onMouseEnter={() => !isHero && prefetchMatches(entry.name)}
                    className={heroClasses}
                    data-hero-row={isHero ? 'true' : undefined}
                  >
                    {row.getAllCells().map(cell => {
                      if (isHero && cell.column.id === 'name') {
                        return (
                          <TableCell key={cell.id}>
                            <div className="flex items-center gap-2 font-medium">
                              <span>{entry.name}</span>
                              <span className="inline-flex shrink-0 items-center rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold tracking-wide uppercase text-amber-700 dark:text-amber-300">
                                {t('leaderboardPage.heroYou')}
                              </span>
                            </div>
                          </TableCell>
                        )
                      }
                      if (isHero && cell.column.id === 'position' && heroFilteredOut) {
                        return (
                          <TableCell key={cell.id}>
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="font-mono font-semibold tabular-nums">
                                #{entry.position}
                              </span>
                              <span className="text-[10px] tracking-wide uppercase text-foreground/60">
                                {t('leaderboardPage.heroFilteredOut')}
                              </span>
                            </div>
                          </TableCell>
                        )
                      }
                      return (
                        <TableCell key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                  {isExpanded && !isHero && (
                    <TableRow>
                      <TableCell
                        colSpan={columns.length}
                        className="border-t border-foreground/10 bg-page px-2 py-4 sm:px-4 sm:py-6"
                      >
                        <PlayerGames
                          matches={expandedMatches}
                          isLoading={isLoadingMatches}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              )
            })
          ) : (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={columns.length}
                className="h-24 text-center text-foreground/60"
              >
                {t('leaderboardPage.empty')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
