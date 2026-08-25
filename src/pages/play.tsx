import { PlayHeader } from '@/components/play-header'
import { StreamsSection } from '@/components/streams-section'

export function PlayPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="h-[50vh]">
        <PlayHeader />
      </div>
      <div className="flex flex-1 flex-col">
        <StreamsSection />
        <div className="flex-1">
          {/* Page content goes here */}
        </div>
      </div>
    </div>
  )
}
