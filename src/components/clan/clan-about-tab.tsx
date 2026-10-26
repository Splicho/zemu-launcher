'use client'

import { useTranslation } from 'react-i18next'

import { Spinner } from '@/components/ui/spinner'
import { Card, CardContent } from '@/components/ui/card'

import { useClanFounder } from '@/hooks/use-clan'
import type { ClanProfile } from '@/lib/clan'

/**
 * About tab on the public clan profile.
 *
 * Renders three blocks:
 *   1. The clan's description, or a blank-state line when nothing's
 *      been written.
 *   2. The clan's stats: member count, follower count, created-at,
 *      and a "Created by" link to the founder's player profile
 *      (only when the founder is still a real user — null when
 *      the founder account has been deleted).
 *
 * The role-reminder card (shown on the website when the caller is
 * a leader / officer) is omitted here — the launcher doesn't
 * surface clan-management UI, so the reminder would be confusing
 * without an accompanying action.
 *
 * Mirrors `apps/web/app/clans/[slug]/components/clan-about-tab.tsx`.
 */
export function ClanAboutTab({ clan }: { clan: ClanProfile }) {
  const { t } = useTranslation()
  const { data: founder, isLoading: founderLoading } = useClanFounder(clan.slug)

  const createdAt = new Date(clan.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="space-y-4">
      <Card className="border-border/40 bg-transparent py-0">
        <div className="m-1 rounded-2xl bg-accent">
          <CardContent className="space-y-2 p-4">
            <h3 className="text-xl text-foreground">
              {t('clan.aboutTitle')}
            </h3>
            {clan.description ? (
              <p className="text-sm whitespace-pre-wrap text-foreground/90">
                {clan.description}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('clan.noDescription')}
              </p>
            )}
          </CardContent>
        </div>
      </Card>

      <Card className="border-border/40 bg-transparent py-0">
        <div className="m-1 rounded-2xl bg-accent">
          <CardContent className="grid gap-x-6 gap-y-3 p-4 sm:grid-cols-2">
            <Stat label={t('clan.stats.members')} value={String(clan.memberCount)} />
            <Stat
              label={t('clan.stats.followers')}
              value={String(clan.followerCount)}
            />
            <Stat label={t('clan.stats.created')} value={createdAt} />
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                {t('clan.stats.foundedBy')}
              </p>
              {founderLoading ? (
                <Spinner className="size-3" />
              ) : founder?.displayName ? (
                <a
                  href={`#/player/${encodeURIComponent(founder.displayName)}`}
                  className="inline-flex items-center gap-2 text-sm hover:underline"
                >
                  {founder.avatarUrl ? (
                    <img
                      src={founder.avatarUrl}
                      alt=""
                      width={20}
                      height={20}
                      className="size-5 rounded-full object-cover"
                    />
                  ) : null}
                  {founder.displayName}
                </a>
              ) : (
                <p className="text-sm text-muted-foreground">—</p>
              )}
            </div>
          </CardContent>
        </div>
      </Card>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">
        {label}
      </p>
      <p className="text-sm text-foreground tabular-nums">{value}</p>
    </div>
  )
}
