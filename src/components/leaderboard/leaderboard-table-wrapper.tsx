"use client"

import { useState, useMemo } from 'react'
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination'
import Filter, { DEFAULT_FILTERS, type LeaderboardFilters } from '@/components/leaderboard/filter'
import LeaderboardTable from '@/components/leaderboard/leaderboard-table'
import { HeroRow } from '@/components/leaderboard/hero-row'
import { useAuthContext } from '@/contexts/auth-context'
import { useLeaderboardEntries, useClantags } from '@/hooks/use-leaderboard'
import type { LeaderboardEntry } from '@/lib/leaderboard'

function getUniqueCountries(entries: readonly LeaderboardEntry[]): string[] {
  const seen = new Set<string>()
  for (const e of entries) {
    if (e.country) seen.add(e.country)
  }
  return Array.from(seen).sort()
}

function buildPageRanges(
  currentPage: number,
  totalPages: number,
): Array<number | 'ellipsis'> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  const pages: Array<number | 'ellipsis'> = [1]
  if (currentPage > 3) pages.push('ellipsis')
  const start = Math.max(2, currentPage - 1)
  const end = Math.min(totalPages - 1, currentPage + 1)
  for (let i = start; i <= end; i++) pages.push(i)
  if (currentPage < totalPages - 2) pages.push('ellipsis')
  pages.push(totalPages)
  return pages
}

export default function LeaderboardTableWrapper() {
  const { token } = useAuthContext()
  const authName = token?.displayName ?? null

  const { data: entries = [], isLoading } = useLeaderboardEntries()

  const [filters, setFilters] = useState<LeaderboardFilters>(DEFAULT_FILTERS)
  const [page, setPage] = useState(1)

  const handleFilterChange = (updated: LeaderboardFilters) => {
    setFilters(updated)
    setPage(1)
  }

  // Derive the signed-in user's entry so we can pin a hero row.
  const heroEntry = useMemo(() => {
    if (!authName) return null
    return entries.find(e => e.name.toLowerCase() === authName.toLowerCase()) ?? null
  }, [entries, authName])

  // Prefetch clan tags for all visible names.
  const visibleNames = useMemo(() => {
    return entries.map(e => e.name.toLowerCase())
  }, [entries])

  const { data: clanTagMap = new Map() } = useClantags(visibleNames)

  // Apply client-side filters.
  const filtered = useMemo(() => {
    const q = filters.search.toLowerCase()
    return entries.filter(e => {
      if (q && !e.name.toLowerCase().includes(q)) return false
      if (filters.tier !== 'all' && e.tier !== filters.tier) return false
      if (filters.country && e.country !== filters.country) return false
      return true
    })
  }, [entries, filters])

  // Check whether the hero row would be filtered out so we can
  // dim it on the standalone hero strip. The main table is
  // unaffected — it only renders `visibleEntries` (which already
  // excludes the user's entry when their filter combination hides
  // them).
  const heroFilteredOut = useMemo(() => {
    if (!heroEntry) return false
    return !filtered.includes(heroEntry)
  }, [filtered, heroEntry])

  // Page math.
  const pageSize = filters.pageSize
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, totalPages || 1)

  const visibleEntries = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    const end = start + pageSize
    return filtered.slice(start, end)
  }, [filtered, currentPage, pageSize])

  const uniqueCountries = useMemo(() => getUniqueCountries(entries), [entries])
  const clanTagRecord = useMemo(() => {
    const record: Record<string, { clanSlug: string; clanName: string; clantag: string }> = {}
    clanTagMap.forEach((v, k) => {
      record[k] = v
    })
    return record
  }, [clanTagMap])

  const pageRanges = useMemo(
    () => buildPageRanges(currentPage, totalPages),
    [currentPage, totalPages],
  )

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Filter
        onFilterChange={handleFilterChange}
        availableCountries={uniqueCountries}
      />

      {heroEntry && (
        <HeroRow
          entry={heroEntry}
          clanTags={clanTagRecord}
          dimmed={heroFilteredOut}
        />
      )}

      <LeaderboardTable
        entries={visibleEntries}
        clanTags={clanTagRecord}
        isLoading={isLoading}
        filters={filters}
      />

      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={e => {
                  e.preventDefault()
                  setPage(p => Math.max(1, p - 1))
                }}
                className={currentPage === 1 ? 'pointer-events-none opacity-40' : undefined}
              />
            </PaginationItem>

            {pageRanges.map((p, i) =>
              p === 'ellipsis' ? (
                <PaginationItem key={`ellipsis-${i}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={p}>
                  <PaginationLink
                    isActive={p === currentPage}
                    onClick={e => {
                      e.preventDefault()
                      setPage(p)
                    }}
                  >
                    {p}
                  </PaginationLink>
                </PaginationItem>
              ),
            )}

            <PaginationItem>
              <PaginationNext
                onClick={e => {
                  e.preventDefault()
                  setPage(p => Math.min(totalPages, p + 1))
                }}
                className={currentPage === totalPages ? 'pointer-events-none opacity-40' : undefined}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  )
}
