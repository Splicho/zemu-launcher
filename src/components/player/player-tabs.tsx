import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs'
import { PlayerOverviewTab } from '@/components/player/player-overview-tab'
import { PlayerAboutTab } from '@/components/player/player-about-tab'
import type { PlayerProfile } from '@/lib/player-profile'

/**
 * Tabbed section on the public player profile page.
 *
 * Mirrors the website's `apps/web/app/player/[displayName]/
 * components/player-tabs.tsx`. Uses the launcher project's
 * `Tabs` primitives which expose a `variant="line"` prop matching
 * the website's underline-tab style.
 *
 * The Tabs primitives are a `"use client"` component, so this whole
 * file is a client component — that's why the tab shell lives here
 * and the page itself stays a server-style orchestrator.
 */
export function PlayerTabs({ profile }: { profile: PlayerProfile }) {
  return (
    <Tabs defaultValue="overview" className="mt-6">
      <div className="border-b">
        <TabsList variant="line">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="match-history">Match history</TabsTrigger>
          <TabsTrigger value="about">About {profile.displayName}</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="overview" className="py-8">
        <PlayerOverviewTab />
      </TabsContent>

      <TabsContent value="match-history" className="py-8">
        <p className="text-muted-foreground">
          Match history isn&apos;t available yet. Check back later!
        </p>
      </TabsContent>

      <TabsContent value="about" className="py-8">
        <PlayerAboutTab profile={profile} />
      </TabsContent>
    </Tabs>
  )
}
