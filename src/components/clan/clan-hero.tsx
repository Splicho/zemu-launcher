import { useTranslation } from 'react-i18next'

import { ClantagBadge } from '@/components/leaderboard/clantag-badge'
import { Verified } from '@/components/icons/verified'
import type { ClanProfile } from '@/lib/clan'

/**
 * Full-bleed header for the clan profile. The cover image (rendered
 * by `MainLayout` as the window backdrop, like the play page) shows
 * through behind it; the clan's identity
 * (avatar, name, tag, headline stats) sits on top of it, bottom-left,
 * with the action surface passed in as `actions` on the right.
 * Clans without a cover get a dark red wash instead.
 */
export function ClanHero({
  clan,
  actions,
}: {
  clan: ClanProfile
  actions?: React.ReactNode
}) {
  const { t } = useTranslation()
  const founded = new Date(clan.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
  })

  return (
    <section className="relative isolate flex min-h-[max(22rem,50vh)] flex-col justify-end overflow-hidden">
      {/* With a cover, the image is the layout's full-window backdrop
          (see `usePageBackground` in `ClanView`), so the hero stays
          transparent. Without one, a red wash stands in for it. */}
      {clan.coverImageUrl ? null : (
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-20 bg-[radial-gradient(ellipse_at_top_right,oklch(0.36_0.15_29.11)_0%,transparent_65%)]"
        />
      )}

      <div className="flex flex-wrap items-end justify-between gap-6 px-6 pt-24 pb-8 sm:px-8">
        <div className="flex min-w-0 items-end gap-5">
          <div className="size-24 shrink-0 overflow-hidden rounded-2xl bg-muted shadow-2xl ring-1 ring-white/15 sm:size-32">
            {clan.avatarUrl ? (
              <img
                src={clan.avatarUrl}
                alt={`${clan.name}'s avatar`}
                className="h-full w-full object-cover"
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex h-full w-full items-center justify-center text-4xl font-bold text-muted-foreground"
              >
                {clan.clantag.charAt(0).toUpperCase()}
              </span>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-3 pb-1">
            <div className="flex min-w-0 items-center gap-3">
              <h1 className="min-w-0 truncate text-4xl leading-tight font-bold tracking-tight sm:text-5xl">
                {clan.name}
              </h1>
              {clan.isVerified ? (
                <Verified className="size-6 shrink-0" aria-label="Verified clan" />
              ) : null}
              <ClantagBadge tag={clan.clantag} size="lg" className="shrink-0 rounded-sm" />
            </div>
            <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <HeroStat value={String(clan.memberCount)} label={t('clan.stats.members')} />
              <HeroStat value={String(clan.followerCount)} label={t('clan.stats.followers')} />
              <HeroStat value={founded} label={t('clan.stats.created')} labelFirst />
            </dl>
          </div>
        </div>

        {actions}
      </div>
    </section>
  )
}

/** Reads as "12 Members" by default, or "Created Mar 2024" with `labelFirst`. */
function HeroStat({
  value,
  label,
  labelFirst = false,
}: {
  value: string
  label: string
  labelFirst?: boolean
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={`font-semibold text-foreground tabular-nums ${labelFirst ? '' : 'order-first'}`}
      >
        {value}
      </dd>
    </div>
  )
}
