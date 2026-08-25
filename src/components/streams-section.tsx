import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

const mockStreams = [
  {
    id: 1,
    thumbnail: 'https://picsum.photos/seed/stream1/400/225',
    streamer: 'PlayerOne',
    viewers: '12.5K',
  },
  {
    id: 2,
    thumbnail: 'https://picsum.photos/seed/stream2/400/225',
    streamer: 'ProGamer99',
    viewers: '8.2K',
  },
  {
    id: 3,
    thumbnail: 'https://picsum.photos/seed/stream3/400/225',
    streamer: 'ZEmuOfficial',
    viewers: '45.1K',
  },
  {
    id: 4,
    thumbnail: 'https://picsum.photos/seed/stream4/400/225',
    streamer: 'NightOwl',
    viewers: '3.7K',
  },
  {
    id: 5,
    thumbnail: 'https://picsum.photos/seed/stream5/400/225',
    streamer: 'NewbieGamer',
    viewers: '1.2K',
  },
]

export function StreamsSection() {
  const [currentIndex, setCurrentIndex] = useState(0)
  const visibleCount = 3

  const goPrev = () => {
    setCurrentIndex((prev) => (prev === 0 ? mockStreams.length - visibleCount : prev - 1))
  }

  const goNext = () => {
    setCurrentIndex((prev) => (prev >= mockStreams.length - visibleCount ? 0 : prev + 1))
  }

  const visibleStreams = mockStreams.slice(currentIndex, currentIndex + visibleCount)

  return (
    <section className="px-8">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Streams</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={goPrev} className="rounded-full">
            <ChevronLeft className="size-5" />
          </Button>
          <Button variant="outline" size="icon" onClick={goNext} className="rounded-full">
            <ChevronRight className="size-5" />
          </Button>
        </div>
      </div>

      <div className="mt-4 overflow-hidden">
        <div className="flex gap-4 transition-transform duration-300">
          {visibleStreams.map((stream) => (
            <div
              key={stream.id}
              className="relative min-w-0 flex-1 overflow-hidden rounded-xl"
            >
              <img
                src={stream.thumbnail}
                alt={`${stream.streamer}'s stream`}
                className="aspect-video w-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3">
                <p className="truncate text-sm font-medium text-white">{stream.streamer}</p>
                <span className="text-xs text-white/80">{stream.viewers} viewers</span>
              </div>
              <span className="absolute left-2 top-2 rounded bg-red-500 px-1.5 py-0.5 text-xs font-medium text-white">
                LIVE
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
