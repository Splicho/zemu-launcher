import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'

import { fetchClanBySlug, type ClanProfile } from '@/lib/clan'
import { useHashRouter } from '@/hooks/use-hash'
import { usePageBackground } from '@/contexts/page-background-context'
import { Button } from '@/components/ui/button'
import { ClanHero } from '@/components/clan/clan-hero'
import { ClanActions } from '@/components/clan/clan-actions'
import { ClanSkeleton } from '@/components/clan/clan-skeleton'
import { ClanTabs } from '@/components/clan/clan-tabs'

/**
 * Clan profile page — mounted at `#/clan/:slug`.
 *
 * Mirrors the website's `apps/web/app/clans/[slug]/page.tsx`:
 *   - Back button floating over the top-left of the hero
 *   - Full-bleed hero: cover image, avatar, name, clantag and
 *     headline stats
 *   - Action surface (Follow / Request to join / leader-only
 *     Manage clan / per-member Leave-clan overflow)
 *   - Tabbed section (members, followers, match-history stub, about)
 *
 * The page itself only handles routing + data fetching and the
 * orchestration of the header pieces. Each header element lives in
 * its own component under `components/clan/`:
 *   - `ClanHero`        — cover + identity + headline stats
 *   - `ClanActions`     — follow / join / manage / leave (owns the
 *                          leave-confirmation dialog and the
 *                          request-join dialog)
 *   - `ClanSkeleton`    — loading skeleton
 *   - `ClanTabs`        — tabbed content
 *
 * The website resolves `isMember` + `role` server-side via
 * `getCallerMembership`. The launcher routes its reads through the
 * tooltip endpoint with the launcher's bearer attached, which lets
 * the api's `OptionalAuthGuard` populate `callerRole` on the same
 * response. When the bearer isn't attached (signed-out visitor)
 * the role comes back null and the page renders only the public
 * affordances.
 */
export function ClanPage({ slug }: { slug: string }) {
  const { t } = useTranslation()
  const { navigate } = useHashRouter()
  const decoded = decodeURIComponent(slug)
  const [clan, setClan] = useState<ClanProfile | null | 'loading' | 'missing'>(
    'loading',
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setClan('loading')
    setError(null)
    fetchClanBySlug(decoded)
      .then((result) => {
        if (cancelled) return
        setClan(result ?? 'missing')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load clan')
      })
    return () => {
      cancelled = true
    }
  }, [decoded])

  return (
    // `-mx-6 sm:-mx-8` cancels <main>'s horizontal padding so the hero
    // cover can run edge to edge; the sections below re-apply it.
    <div className="relative -mx-6 flex flex-1 flex-col overflow-hidden sm:-mx-8">
      <div className="absolute top-6 left-6 z-20 sm:left-8">
        <Button
          onClick={() => navigate('/clans')}
          variant="outline"
          className="inline-flex h-9 items-center gap-1.5 rounded-md border-white/10 bg-black/40 px-3 text-sm text-white/80 backdrop-blur-md transition-colors hover:bg-black/60 hover:text-white"
        >
          <ArrowLeft className="size-4" />
          {t('clan.backToDirectory')}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto pb-10">
        <div className="flex flex-col gap-6">
          {clan === 'loading' && <ClanSkeleton />}

          {error && (
            <p className="px-6 pt-20 text-sm text-muted-foreground sm:px-8">
              {t('clan.failedLoad', { error })}
            </p>
          )}

          {clan === 'missing' && (
            <div className="flex flex-col gap-3 px-6 pt-20 sm:px-8">
              <h1 className="text-2xl font-semibold">{t('clan.notFound')}</h1>
              <p className="text-sm text-muted-foreground">
                {t('clan.notFoundDesc', { slug: decoded })}
              </p>
            </div>
          )}

          {clan && clan !== 'loading' && clan !== 'missing' && (
            <ClanView clan={clan} />
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Orchestrates the loaded clan profile: the hero (with the action
 * surface slotted into its right side) followed by the tabbed content.
 */
function ClanView({ clan }: { clan: ClanProfile }) {
  usePageBackground(clan.coverImageUrl)
  return (
    <article className="flex flex-col">
      <ClanHero clan={clan} actions={<ClanActions clan={clan} />} />
      <div className="px-6 sm:px-8">
        <ClanTabs clan={clan} />
      </div>
    </article>
  )
}
