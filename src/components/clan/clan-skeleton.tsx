import { Skeleton } from '@/components/ui/skeleton'

/**
 * Loading skeleton for the clan profile page. Mirrors the layout of
 * `<ClanView>` — full-bleed hero with the identity block in its
 * bottom-left, tab strip, roster — so the page doesn't reflow when
 * the tooltip endpoint resolves.
 */
export function ClanSkeleton() {
  return (
    <div className="flex flex-col">
      <div className="flex min-h-[max(22rem,50vh)] items-end gap-5 bg-muted/30 px-6 pt-24 pb-8 sm:px-8">
        <Skeleton className="size-24 shrink-0 rounded-2xl sm:size-32" />
        <div className="flex flex-col gap-3 pb-1">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
      <div className="flex flex-col gap-6 px-6 sm:px-8">
        <Skeleton className="h-9 w-full rounded-md" />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  )
}
