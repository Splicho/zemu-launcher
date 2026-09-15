import { Skeleton } from '@/components/ui/skeleton'

/**
 * Placeholder for a single search result while it's streaming in.
 * Mirrors the layout of `PlayerResultRow` so the list doesn't jump
 * when real rows arrive.
 */
export function SearchResultSkeleton() {
  return (
    <div className="flex items-center gap-2.5 rounded-md px-2.5 py-2.5">
      <Skeleton className="size-8 rounded-full" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-4 w-2/3" />
      </div>
      <Skeleton className="size-7 rounded-md" />
    </div>
  )
}
