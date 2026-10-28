import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'

import { fetchPlayerByDisplayName, type PlayerProfile } from '@/lib/player-profile'
import {
  fetchPlayerMatchStats,
  fetchPlayerRank,
  fetchPlayerRecentMatches,
  type PlayerMatchStats,
  type PlayerRank,
  type PlayerRecentMatch,
} from '@/lib/player-stats'
import { useHashRouter } from '@/hooks/use-hash'
import { Button } from '@/components/ui/button'
import { PlayerCover } from '@/components/player/player-cover'
import { PlayerIdentityRow } from '@/components/player/player-identity-row'
import { PlayerTabs } from '@/components/player/player-tabs'
import { PlayerSkeleton } from '@/components/player/player-skeleton'

/** Everything the Overview tab needs, fetched alongside the profile. */
interface PlayerStatsBundle {
  matchStats: PlayerMatchStats | null
  recentMatches: PlayerRecentMatch[]
  rank: PlayerRank | null
  /**
   * Clock snapshot taken when the stats were fetched. The chart's 7/14/30-day
   * cutoffs read from this instead of calling `Date.now()` during render
   * (impure), which also keeps a re-render from sliding the window.
   */
  now: number
}

const EMPTY_STATS: PlayerStatsBundle = {
  matchStats: null,
  recentMatches: [],
  rank: null,
  now: 0,
}

/**
 * Fetch the three Ghost-backed reads in parallel.
 *
 * `1000` matches wide because the Overview chart's 7/14/30-day filters need
 * enough history to fill the widest window; the API caps what it will return.
 * None of these reject — a Ghost outage degrades to em dashes.
 */
async function loadPlayerStats(displayName: string): Promise<PlayerStatsBundle> {
  const [matchStats, recentMatches, rank] = await Promise.all([
    fetchPlayerMatchStats(displayName),
    fetchPlayerRecentMatches(displayName, 1000),
    fetchPlayerRank(displayName),
  ])
  return { matchStats, recentMatches: recentMatches.matches, rank, now: Date.now() }
}

/**
 * Player profile page — mounted at `#/player/:displayName`.
 *
 * Mirrors the website's `apps/web/app/player/[displayName]/page.tsx`:
 *   - Fetches `GET /v1/players/:displayName` on mount.
 *   - Back button row.
 *   - Cover banner + social-link chips (Discord / Steam).
 *   - Identity row (avatar, display name, clan tooltip, country flag).
 *   - Tabbed section (Overview / Match history / About).
 *
 * The page itself only handles routing + data fetching. Each visual
 * section lives in its own component under `components/player/`:
 *   - `PlayerCover`        — cover banner + social-link chips
 *   - `PlayerIdentityRow`  — avatar + name/flag/clan-tooltip row
 *   - `PlayerTabs`         — tab shell
 *   - `PlayerSkeleton`      — loading skeleton
 *
 * 404s surface as "Player not found" rather than throwing — the api
 * conflates missing and banned (see `players.controller.ts`), and
 * neither warrants a noisy error state.
 *
 * Route hash is consumed directly because `useHash()` returns the
 * full hash string. We `decodeURIComponent` on the way in because
 * display names can contain spaces / punctuation — the app's own
 * `<a href="#/player/<name>">` link encodes it for the hash, and
 * the browser stores it encoded.
 */
export function PlayerPage({ displayName }: { displayName: string }) {
  const { t } = useTranslation()
  const { navigate } = useHashRouter()
  const decoded = decodeURIComponent(displayName)
  const [profile, setProfile] = useState<PlayerProfile | null | 'loading' | 'missing'>('loading')
  const [stats, setStats] = useState<PlayerStatsBundle>(EMPTY_STATS)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setProfile('loading')
    setStats(EMPTY_STATS)
    setError(null)
    fetchPlayerByDisplayName(decoded)
      .then((result) => {
        if (cancelled) return
        setProfile(result ?? 'missing')
        if (!result) return
        // Stats are fetched only after the profile resolves: a 404 for an
        // unknown or banned player should never spend three extra requests.
        // Each helper degrades to null/empty, so a Ghost outage leaves the
        // profile intact.
        void loadPlayerStats(decoded).then((bundle) => {
          if (!cancelled) setStats(bundle)
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load player')
      })
    return () => {
      cancelled = true
    }
  }, [decoded])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 px-8 py-4">
        <Button
          onClick={() => navigate('/leaderboard')}
          variant="outline"
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {t('player.backToLeaderboard')}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-10 pt-4">
        <div className="flex flex-col gap-6">
          {profile === 'loading' && <PlayerSkeleton />}

          {error && (
            <p className="text-sm text-muted-foreground">
              {t('player.failedLoad', { error })}
            </p>
          )}

          {profile === 'missing' && (
            <div className="flex flex-col gap-3">
              <h1 className="text-2xl font-semibold">{t('player.notFound')}</h1>
              <p className="text-sm text-muted-foreground">
                {t('player.notFoundDesc', { name: decoded })}
              </p>
            </div>
          )}

          {profile && profile !== 'loading' && profile !== 'missing' && (
            <PlayerView profile={profile} stats={stats} />
          )}
        </div>
      </div>
    </div>
  )
}

/** Orchestrates the loaded profile. Composes cover + identity row + tabs. */
function PlayerView({ profile, stats }: { profile: PlayerProfile; stats: PlayerStatsBundle }) {
  return (
    <article className="flex flex-col gap-6">
      <PlayerCover profile={profile} />
      <PlayerIdentityRow profile={profile} rank={stats.rank} />
      <PlayerTabs
        profile={profile}
        matchStats={stats.matchStats}
        recentMatches={stats.recentMatches}
        rank={stats.rank}
        now={stats.now}
      />
    </article>
  )
}
