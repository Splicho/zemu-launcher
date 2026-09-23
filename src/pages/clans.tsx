import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  fetchClanDirectory,
  type ClanDirectoryEntry,
} from '@/lib/clan'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'

import { ClanCard } from '@/components/clan/clan-card'
import { ClanFiltersBar } from '@/components/clan/clan-filters-bar'
import { DEFAULT_CLAN_FILTERS } from '@/components/clan/clan-filters'

const PAGE_SIZE = 24

/**
 * Clan directory — public list of every ZEmu clan. Mounted at
 * `#/clans`.
 *
 * Mirrors the web app's `/clans` page: search box + sort + grid
 * of cards + offset pagination. The data flow and the card
 * layout match the website's `apps/web/app/clans/page.tsx`
 * for full visual + behavioral parity.
 */
export function ClansPage() {
  const { t } = useTranslation()
  const [filters, setFilters] = useState(DEFAULT_CLAN_FILTERS)
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{
    rows: ClanDirectoryEntry[]
    totalPages: number
    total: number
  } | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Debounce the search input — `/v1/clans` does a prefix match,
  // so every keystroke would otherwise trigger a request.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(filters.q.trim()), 300)
    return () => clearTimeout(id)
  }, [filters.q])

  // Reset to page 1 whenever the search, visibility, verified, or
  // sort changes.
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, filters.visibility, filters.verified, filters.sort])

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    fetchClanDirectory({
      page,
      pageSize: PAGE_SIZE,
      q: debouncedSearch || undefined,
      isPrivate:
        filters.visibility === 'public'
          ? false
          : filters.visibility === 'private'
            ? true
            : undefined,
      verifiedOnly: filters.verified === 'verified',
      sort: filters.sort,
    })
      .then((result) => {
        if (cancelled) return
        setData({
          rows: result.rows,
          totalPages: result.totalPages,
          total: result.total,
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load clans')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [page, debouncedSearch, filters.visibility, filters.verified, filters.sort])

  const pageItems = useMemo(
    () => buildPageItems(page, data?.totalPages ?? 1),
    [page, data?.totalPages],
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-4 px-8 pt-6 pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {t('clan.directoryTitle')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('clan.directorySubtitle')}
          </p>
        </div>

        <ClanFiltersBar
          value={filters}
          onChange={setFilters}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {error && (
          <p className="text-sm text-muted-foreground">
            {t('clan.failedLoad', { error })}
          </p>
        )}

        {isLoading && !data && <DirectorySkeleton />}

        {data && data.rows.length === 0 && (
          <Card className="border-border/40 bg-transparent py-0">
            <div className="m-1 rounded-2xl bg-accent">
              <CardContent className="p-8 text-center text-muted-foreground">
                {debouncedSearch
                  ? t('clan.emptySearch', { q: debouncedSearch })
                  : t('clan.empty')}
              </CardContent>
            </div>
          </Card>
        )}

        {data && data.rows.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {data.rows.map((entry) => (
              <ClanCard
                key={entry.id}
                clan={{
                  slug: entry.slug,
                  name: entry.name,
                  tag: entry.clantag,
                  avatarUrl: entry.avatarUrl,
                  coverImageUrl: entry.coverImageUrl,
                  isVerified: entry.isVerified,
                  memberCount: entry.memberCount,
                  followerCount: entry.followerCount,
                  topMembers: entry.topMembers,
                }}
              />
            ))}
          </div>
        )}

        {data && data.totalPages > 1 && (
          <div className="mt-8">
            <Pagination className="mx-0 w-auto">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href={page > 1 ? `#/clans?page=${page - 1}` : '#'}
                    onClick={(e) => {
                      e.preventDefault()
                      if (page > 1) setPage(page - 1)
                    }}
                    aria-disabled={page === 1}
                    className={
                      page === 1 ? 'pointer-events-none opacity-50' : undefined
                    }
                  />
                </PaginationItem>
                {pageItems.map((item, idx) =>
                  item === 'ellipsis-left' || item === 'ellipsis-right' ? (
                    <PaginationItem key={`${item}-${idx}`}>
                      <PaginationEllipsis />
                    </PaginationItem>
                  ) : (
                    <PaginationItem key={item}>
                      <PaginationLink
                        href={`#/clans?page=${item}`}
                        onClick={(e) => {
                          e.preventDefault()
                          setPage(item)
                        }}
                        isActive={item === page}
                      >
                        {item}
                      </PaginationLink>
                    </PaginationItem>
                  ),
                )}
                <PaginationItem>
                  <PaginationNext
                    href={
                      page < data.totalPages
                        ? `#/clans?page=${page + 1}`
                        : '#'
                    }
                    onClick={(e) => {
                      e.preventDefault()
                      if (page < data.totalPages) setPage(page + 1)
                    }}
                    aria-disabled={page === data.totalPages}
                    className={
                      page === data.totalPages
                        ? 'pointer-events-none opacity-50'
                        : undefined
                    }
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}
      </div>
    </div>
  )
}

function DirectorySkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <Card key={i} className="overflow-hidden">
          <Skeleton className="h-24 w-full" />
          <div className="-mt-8 px-4 pb-4">
            <Skeleton className="size-14 rounded-full" />
          </div>
          <CardContent className="space-y-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function buildPageItems(
  currentPage: number,
  totalPages: number,
): Array<number | 'ellipsis-left' | 'ellipsis-right'> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  const items: Array<number | 'ellipsis-left' | 'ellipsis-right'> = [1]
  const leftSibling = Math.max(currentPage - 1, 2)
  const rightSibling = Math.min(currentPage + 1, totalPages - 1)
  if (leftSibling > 2) items.push('ellipsis-left')
  for (let i = leftSibling; i <= rightSibling; i++) items.push(i)
  if (rightSibling < totalPages - 1) items.push('ellipsis-right')
  items.push(totalPages)
  return items
}
