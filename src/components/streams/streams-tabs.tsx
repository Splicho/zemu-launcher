import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { StreamCard } from '@/components/streams/stream-card'
import type { StreamInfo } from '@/api/streams'

type StreamsTabsProps = {
  twitch: StreamInfo[]
  kick: StreamInfo[]
}

/**
 * Twitch / Kick tab switcher wrapping two responsive grids of stream cards.
 * Matches the layout used on the zemu-website streams page. Defaults to the
 * Twitch tab so visitors land on the most populated source.
 */
export function StreamsTabs({ twitch, kick }: StreamsTabsProps) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'twitch' | 'kick'>('twitch')

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as 'twitch' | 'kick')}
      className="flex flex-col gap-4"
    >
      <TabsList variant="line" className="self-start">
        <TabsTrigger value="twitch">{t('streams.tabTwitch')}</TabsTrigger>
        <TabsTrigger value="kick">{t('streams.tabKick')}</TabsTrigger>
      </TabsList>

      <TabsContent value="twitch" className="flex-1 outline-none">
        <StreamsGrid streams={twitch} platform="twitch" />
      </TabsContent>
      <TabsContent value="kick" className="flex-1 outline-none">
        <StreamsGrid streams={kick} platform="kick" />
      </TabsContent>
    </Tabs>
  )
}

type StreamsGridProps = {
  streams: StreamInfo[]
  /** Used to namespace card keys and avoid duplicate-id warnings across tabs. */
  platform: 'twitch' | 'kick'
}

/**
 * Responsive grid of stream cards with an empty-state copy fallback.
 * Mirrors the website's `StreamsGrid`: 1 col mobile, 2 col tablet, 3 col desktop.
 */
function StreamsGrid({ streams, platform }: StreamsGridProps) {
  const { t } = useTranslation()

  if (streams.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        {t('streams.noStreams')}
      </p>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-6">
      {streams.map((stream) => (
        <StreamCard key={`${platform}-${stream.id}`} stream={stream} />
      ))}
    </div>
  )
}
