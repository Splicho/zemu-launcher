import { ChevronLeft, ChevronRight } from 'lucide-react'
import useEmblaCarousel from 'embla-carousel-react'
import { Button } from '@/components/ui/button'
import { Eye } from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { fetchStreams } from '@/api/streams'
import { useQuery } from '@tanstack/react-query'

function formatViewers(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}K`
  }
  return String(count)
}

export function StreamsSection() {
  const { data, isLoading } = useQuery({
    queryKey: ['streams'],
    queryFn: fetchStreams,
    refetchInterval: 60000,
  })

  const streams = data ? [...data.twitch, ...data.kick] : []
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: false, align: 'start', skipSnaps: true })

  const scrollPrev = () => emblaApi?.scrollPrev()
  const scrollNext = () => emblaApi?.scrollNext()

  return (
    <section className="px-8">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Streams</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={scrollPrev} className="rounded-full">
            <ChevronLeft className="size-5" />
          </Button>
          <Button variant="outline" size="icon" onClick={scrollNext} className="rounded-full">
            <ChevronRight className="size-5" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="mt-4 flex gap-4 overflow-hidden">
          <div className="w-80 shrink-0 overflow-hidden rounded-xl bg-muted/50">
            <div className="aspect-video w-full animate-pulse bg-muted" />
            <div className="flex items-center gap-3 p-3">
              <div className="size-6 shrink-0 animate-pulse rounded-full bg-muted" />
              <div className="min-w-0 flex-1">
                <div className="h-3.5 animate-pulse rounded bg-muted" />
              </div>
              <div className="h-3.5 w-12 animate-pulse rounded bg-muted" />
            </div>
          </div>
          <div className="w-80 shrink-0 overflow-hidden rounded-xl bg-muted/50">
            <div className="aspect-video w-full animate-pulse bg-muted" />
            <div className="flex items-center gap-3 p-3">
              <div className="size-6 shrink-0 animate-pulse rounded-full bg-muted" />
              <div className="min-w-0 flex-1">
                <div className="h-3.5 animate-pulse rounded bg-muted" />
              </div>
              <div className="h-3.5 w-12 animate-pulse rounded bg-muted" />
            </div>
          </div>
          <div className="w-80 shrink-0 overflow-hidden rounded-xl bg-muted/50">
            <div className="aspect-video w-full animate-pulse bg-muted" />
            <div className="flex items-center gap-3 p-3">
              <div className="size-6 shrink-0 animate-pulse rounded-full bg-muted" />
              <div className="min-w-0 flex-1">
                <div className="h-3.5 animate-pulse rounded bg-muted" />
              </div>
              <div className="h-3.5 w-12 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
      ) : streams.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Nobody is streaming ZEmu right now. Check back later!</p>
      ) : (
        <div ref={emblaRef} className="mt-4 overflow-hidden">
          <div className="flex gap-4">
            {streams.map((stream) => (
              <a
                key={stream.id}
                href={stream.stream_url ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative min-w-0 flex-[0_0_calc(100%_/_3_-_8px)] overflow-hidden rounded-xl"
              >
                <img
                  src={stream.thumbnail_url}
                  alt={stream.title}
                  className="aspect-video w-full object-cover transition-[filter,transform] duration-300 group-hover:brightness-110"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3">
                  <p className="flex items-center gap-2 truncate text-sm font-medium text-white">
                    <img
                      src={stream.profile_image_url}
                      alt={stream.user_name}
                      className="size-6 rounded-full bg-muted"
                    />
                    <span className="truncate">{stream.user_name}</span>
                    <Badge variant="secondary" className="ml-auto shrink-0 gap-1 text-xs">
                      <Eye size={12} />
                      {formatViewers(stream.viewer_count)}
                    </Badge>
                  </p>
                </div>
                <span className="absolute left-2 top-2 rounded bg-red-500 px-1.5 py-0.5 text-xs font-medium text-white">
                  LIVE
                </span>
              </a>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
