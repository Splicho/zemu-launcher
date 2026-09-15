import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'

import { fetchStreams } from '@/api/streams'
import { StreamsTabs } from '@/components/streams/streams-tabs'
import { Separator } from '@/components/ui/separator'

/**
 * Streams page — mounted at `#/streams`.
 *
 * Replicates the layout used on the zemu-website streams page: a page
 * header, then a Twitch/Kick tab switcher with a responsive grid of
 * live stream cards under each tab.
 *
 * Uses the same `queryKey: ['streams']` as the StreamsSection widget on
 * the Play page, so toggling between Play and Streams does not trigger
 * a second network request — TanStack Query dedupes by key.
 */
export function StreamsPage() {
  const { t } = useTranslation()
  const { data, isLoading, error } = useQuery({
    queryKey: ['streams'],
    queryFn: fetchStreams,
    refetchInterval: 60000,
  })

  return (
    <div className="flex flex-1 flex-col gap-6 py-6">
      <header className="px-2">
        <h1 className="text-3xl tracking-tight">
          {t('streams.title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('streams.subtitle')}
        </p>
      </header>

      <Separator />

      {isLoading ? (
        <StreamsGridSkeleton />
      ) : error && !data ? (
        <p role="alert" className="text-sm text-destructive">
          {t('streams.failedLoad', { error: error.message })}
        </p>
      ) : data ? (
        <StreamsTabs twitch={data.twitch} kick={data.kick} />
      ) : (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {t('streams.noStreams')}
        </p>
      )}
    </div>
  )
}

/**
 * Loading placeholder that mirrors the StreamsGrid responsive layout so
 * the page doesn't jump when data arrives.
 */
function StreamsGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="aspect-video w-full overflow-hidden rounded-xl bg-muted"
        >
          <div className="h-full w-full animate-pulse bg-muted" />
        </div>
      ))}
    </div>
  )
}
