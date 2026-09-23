import { Skeleton } from '@/components/ui/skeleton'

/**
 * Loading skeleton for the clan profile page. Mirrors the layout of
 * `<ClanView>` — cover banner, identity row, tab strip, member grid —
 * so the page doesn't reflow when the tooltip endpoint resolves.
 */
export function ClanSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-64 w-full rounded-3xl" />
      <div className="-mt-10 flex items-end gap-4 px-2 sm:-mt-14 sm:px-4">
        <Skeleton className="size-20 shrink-0 rounded-4xl border-4 border-page sm:size-28" />
        <div className="flex flex-col gap-2 pb-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
      <Skeleton className="h-10 w-full rounded-md" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    </div>
  )
}
