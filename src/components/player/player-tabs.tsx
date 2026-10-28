import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs'
import { PlayerOverviewTab } from '@/components/player/player-overview-tab'
import { PlayerMatchHistoryTab } from '@/components/player/player-match-history-tab'
import { PlayerAboutTab } from '@/components/player/player-about-tab'
import type { PlayerProfile } from '@/lib/player-profile'
import type { PlayerMatchStats, PlayerRank, PlayerRecentMatch } from '@/lib/player-stats'

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
export function PlayerTabs({
  profile,
  matchStats,
  recentMatches,
  rank,
  now,
}: {
  profile: PlayerProfile
  matchStats: PlayerMatchStats | null
  recentMatches: PlayerRecentMatch[]
  rank: PlayerRank | null
  /** Clock snapshot from the stats fetch — the chart's day cutoffs use it. */
  now: number
}) {
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
        <PlayerOverviewTab
          matchStats={matchStats}
          recentMatches={recentMatches}
          rank={rank}
          now={now}
          banned={profile.banned ?? false}
          bannedAt={profile.bannedAt ?? null}
          bannedReason={profile.bannedReason ?? null}
        />
      </TabsContent>

      <TabsContent value="match-history" className="py-8">
        <PlayerMatchHistoryTab matches={recentMatches} />
      </TabsContent>

      <TabsContent value="about" className="py-8">
        <PlayerAboutTab profile={profile} />
      </TabsContent>
    </Tabs>
  )
}
