import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'

import { fetchClanBySlug, type ClanProfile } from '@/lib/clan'
import { useHashRouter } from '@/hooks/use-hash'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ClanCover } from '@/components/clan/clan-cover'
import { ClanIdentityRow } from '@/components/clan/clan-identity-row'
import { ClanActions } from '@/components/clan/clan-actions'
import { ClanSkeleton } from '@/components/clan/clan-skeleton'
import { ClanTabs } from '@/components/clan/clan-tabs'

/**
 * Clan profile page — mounted at `#/clan/:slug`.
 *
 * Mirrors the website's `apps/web/app/clans/[slug]/page.tsx`:
 *   - Back button row
 *   - Cover banner (`h-64`, `brightness-50`)
 *   - Identity row (`-mt-14 sm:-mt-20`, avatar overlapping the
 *     banner with a `border-4 border-page` ring; rounded-4xl avatar)
 *   - Action surface (Follow / Request to join / leader-only
 *     Manage clan / per-member Leave-clan overflow)
 *   - Tabbed section (members, followers, match-history stub, about)
 *
 * The page itself only handles routing + data fetching and the
 * orchestration of the header pieces. Each header element lives in
 * its own component under `components/clan/`:
 *   - `ClanCover`       — cover banner image
 *   - `ClanIdentityRow` — avatar + name + clantag badge
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
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 px-8 py-3">
        <Button
          onClick={() => navigate('/clans')}
          variant="outline"
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {t('clan.backToDirectory')}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-10 pt-2">
        <div className="flex flex-col gap-6">
          {clan === 'loading' && <ClanSkeleton />}

          {error && (
            <p className="text-sm text-muted-foreground">
              {t('clan.failedLoad', { error })}
            </p>
          )}

          {clan === 'missing' && (
            <div className="flex flex-col gap-3">
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
 * Orchestrates the loaded clan profile. Each section of the header
 * (cover, identity row, actions) is a self-contained component under
 * `components/clan/`; this view just lays them out and pairs the
 * identity row with the action surface via a shared flex container.
 */
function ClanView({ clan }: { clan: ClanProfile }) {
  return (
    <article className="flex flex-col gap-6">
      <ClanCover coverImageUrl={clan.coverImageUrl} name={clan.name} />

      {/*
        Identity row + action surface share a single flex container
        so they align at the same bottom edge. The negative margin
        that pulls them up into the cover lives on
        `<ClanIdentityRow>`.
      */}
      <div className="flex items-end gap-4 justify-between">
        <ClanIdentityRow
          avatarUrl={clan.avatarUrl}
          name={clan.name}
          clantag={clan.clantag}
          isVerified={clan.isVerified}
          hasCover={Boolean(clan.coverImageUrl)}
        />
        <ClanActions clan={clan} />
      </div>

      <Separator />

      <ClanTabs clan={clan} />
    </article>
  )
}
