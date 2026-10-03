import { PlayHeader } from '@/components/play-header'
import { StreamsSection } from '@/components/streams-section'
import { GAME_BACKGROUNDS, GAME_BACKGROUND_INTERVAL_MS } from '@/config/backgrounds'
import { usePageBackground } from '@/contexts/page-background-context'
import { useRotatingImage } from '@/hooks/use-rotating-image'

export function PlayPage() {
  // Same screenshot rotation as the login screen, shown as the
  // layout's full-window backdrop; `MainLayout` crossfades on change.
  usePageBackground(useRotatingImage(GAME_BACKGROUNDS, GAME_BACKGROUND_INTERVAL_MS))

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
