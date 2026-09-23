'use client'

import { useTranslation } from 'react-i18next'

import { Spinner } from '@/components/ui/spinner'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'

import { useClanFollowers } from '@/hooks/use-clan'

/**
 * Followers tab on the public clan profile.
 *
 * Renders the follower list as a card grid (3 columns on `sm:`+).
 * Each cell shows the follower's avatar, display name (linked to
 * their player profile), and when they followed the clan.
 *
 * Mirrors `apps/web/app/clans/[slug]/components/clan-followers-tab.tsx`.
 */
export function ClanFollowersTab({ slug }: { slug: string }) {
  const { t } = useTranslation()
  const { data, isLoading } = useClanFollowers(slug, { pageSize: 100 })

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Spinner className="size-5" />
      </div>
    )
  }

  const followers = data?.rows ?? []
  if (followers.length === 0) {
    return (
      <Card className="border-border/40 bg-transparent py-0">
        <div className="m-1 rounded-2xl bg-accent">
          <CardContent className="p-4 text-muted-foreground">
            {t('clan.noFollowers')}
          </CardContent>
        </div>
      </Card>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {followers.map((follower) => (
        <FollowerCell key={follower.userId} follower={follower} />
      ))}
    </div>
  )
}

function FollowerCell({
  follower,
}: {
  follower: {
    userId: string
    displayName: string | null
    avatarUrl: string | null
    followedAt: string
  }
}) {
  const { t } = useTranslation()
  const displayName = follower.displayName ?? 'Unknown player'
  const initials = displayName.charAt(0).toUpperCase()
  const followed = new Date(follower.followedAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
  })

  return (
    <a
      href={`#/player/${encodeURIComponent(displayName)}`}
      className="group rounded-2xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Card className="border-border/40 bg-transparent py-0 transition-colors group-hover:bg-accent/60">
        <div className="m-1 rounded-2xl">
          <CardContent className="flex items-center gap-3 p-4">
            <Avatar className="size-12 shrink-0">
              {follower.avatarUrl ? (
                <AvatarImage src={follower.avatarUrl} alt={displayName} />
              ) : null}
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-foreground">
                {displayName}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('clan.followingSince', { date: followed })}
              </p>
            </div>
          </CardContent>
        </div>
      </Card>
    </a>
  )
}
