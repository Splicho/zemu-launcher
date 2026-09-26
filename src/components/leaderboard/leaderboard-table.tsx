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
}

export default function LeaderboardTable({
  entries,
  columns = leaderboardColumns,
  isLoading = false,
  clanTags = {},
}: LeaderboardTableProps) {
  const { t } = useTranslation()
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null)
  const topMatchesQuery = usePlayerTopMatches(expandedPlayer)
  const expandedMatches = topMatchesQuery.data ?? []
  const isLoadingMatches = topMatchesQuery.isFetching

  const [sorting, setSorting] = useState([{ id: 'top10TotalScore', desc: true }])

  const tableData = useMemo(
    () => entries as unknown as Array<LeaderboardEntry & { __id?: string }>,
    [entries],
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
    getRowId: (_row, index) => `row-${index}`,
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
              const isExpanded = expandedRow === row.id
              return (
                <Fragment key={row.id}>
                  <TableRow
                    onClick={() => handleRowClick(row.id, entry.name)}
                    onMouseEnter={() => prefetchMatches(entry.name)}
                    className="cursor-pointer hover:bg-foreground/5"
                  >
                    {row.getAllCells().map(cell => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                  {isExpanded && (
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
