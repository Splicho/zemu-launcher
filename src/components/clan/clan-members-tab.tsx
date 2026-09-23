'use client'

import { useTranslation } from 'react-i18next'

import { Spinner } from '@/components/ui/spinner'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'

import { useClanMembers } from '@/hooks/use-clan'

/**
 * Members tab on the public clan profile.
 *
 * Renders the roster as a card grid (3 columns on `lg:`+ so the
 * page doesn't grow too tall with a long roster). Each cell
 * shows the player's avatar, display name (linked to their
 * player profile), and a role badge — "Leader" / "Officer" /
 * "Member" — plus the join date in the bottom-right corner.
 *
 * Mirrors `apps/web/app/clans/[slug]/components/clan-members-tab.tsx`.
 */
export function ClanMembersTab({ slug }: { slug: string }) {
  const { t } = useTranslation()
  const { data, isLoading } = useClanMembers(slug, { pageSize: 100 })

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Spinner className="size-5" />
      </div>
    )
  }

  const members = data?.rows ?? []
  if (members.length === 0) {
    return (
      <Card className="border-border/40 bg-transparent py-0">
        <div className="m-1 rounded-2xl bg-accent">
          <CardContent className="p-4 text-muted-foreground">
            {t('clan.noMembers')}
          </CardContent>
        </div>
      </Card>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {members.map((member) => (
        <MemberCell key={member.userId} member={member} />
      ))}
    </div>
  )
}

function MemberCell({
  member,
}: {
  member: {
    userId: string
    displayName: string | null
    avatarUrl: string | null
    role: 'leader' | 'officer' | 'member'
    joinedAt: string
  }
}) {
  const { t } = useTranslation()
  const displayName = member.displayName ?? 'Unknown player'
  const initials = displayName.charAt(0).toUpperCase()
  const joined = new Date(member.joinedAt).toLocaleDateString(undefined, {
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
          <CardContent className="relative flex items-center gap-3 p-4">
            <Avatar className="size-12 shrink-0">
              {member.avatarUrl ? (
                <AvatarImage src={member.avatarUrl} alt={displayName} />
              ) : null}
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <span className="block truncate font-medium text-foreground">
                {displayName}
              </span>
              <RoleBadge role={member.role} />
            </div>
            <p className="absolute right-4 bottom-4 text-xs text-muted-foreground">
              {t('clan.memberJoined', { date: joined })}
            </p>
          </CardContent>
        </div>
      </Card>
    </a>
  )
}

function RoleBadge({ role }: { role: 'leader' | 'officer' | 'member' }) {
  const { t } = useTranslation()
  const label =
    role === 'leader'
      ? t('clan.roles.leader')
      : role === 'officer'
        ? t('clan.roles.officer')
        : t('clan.roles.member')
  return <span className="text-xs text-muted-foreground">{label}</span>
}
