import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'

import { fetchPlayerByDisplayName, type PlayerProfile } from '@/lib/player-profile'
import { useHashRouter } from '@/hooks/use-hash'
import { Button } from '@/components/ui/button'
import { PlayerCover } from '@/components/player/player-cover'
import { PlayerIdentityRow } from '@/components/player/player-identity-row'
import { PlayerTabs } from '@/components/player/player-tabs'
import { PlayerSkeleton } from '@/components/player/player-skeleton'

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
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setProfile('loading')
    setError(null)
    fetchPlayerByDisplayName(decoded)
      .then((result) => {
        if (cancelled) return
        setProfile(result ?? 'missing')
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
            <PlayerView profile={profile} />
          )}
        </div>
      </div>
    </div>
  )
}

/** Orchestrates the loaded profile. Composes cover + identity row + tabs. */
function PlayerView({ profile }: { profile: PlayerProfile }) {
  return (
    <article className="flex flex-col gap-6">
      <PlayerCover profile={profile} />
      <PlayerIdentityRow profile={profile} />
      <PlayerTabs profile={profile} />
    </article>
  )
}
