'use client'

import { useTranslation } from 'react-i18next'

import { Spinner } from '@/components/ui/spinner'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

import { useClanMembers } from '@/hooks/use-clan'

/**
 * Members tab on the public clan profile.
 *
 * Renders the roster grouped by rank (leaders, officers, members),
 * each group headed by its role and head-count. Rows are compact
 * (avatar, display name linked to the player profile, join date) in
 * a 3-column grid on `lg:`+; leader rows get a red-tinted highlight.
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

  // The roster reads top-down by rank: leaders, then officers, then
  // everyone else. Grouping replaces the per-row role badge.
  const groups = ROLE_ORDER.map((role) => ({
    role,
    rows: members.filter((m) => m.role === role),
  })).filter((group) => group.rows.length > 0)

  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => (
        <section key={group.role} aria-labelledby={`clan-role-${group.role}`}>
          <h3
            id={`clan-role-${group.role}`}
            className="mb-3 flex items-baseline gap-2 text-sm font-medium text-foreground"
          >
            {t(`clan.roles.${group.role}`)}
            <span className="text-muted-foreground tabular-nums">
              {group.rows.length}
            </span>
          </h3>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {group.rows.map((member) => (
              <li key={member.userId}>
                <MemberRow member={member} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

const ROLE_ORDER = ['leader', 'officer', 'member'] as const

function MemberRow({
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
  const isLeader = member.role === 'leader'

  return (
    <a
      href={`#/player/${encodeURIComponent(displayName)}`}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isLeader
          ? 'bg-primary/20 ring-1 ring-primary/50 hover:bg-primary/30'
          : 'bg-white/[0.03] hover:bg-white/[0.07]',
      )}
    >
      <Avatar className={cn('shrink-0', isLeader ? 'size-11' : 'size-9')}>
        {member.avatarUrl ? (
          <AvatarImage src={member.avatarUrl} alt={displayName} />
        ) : null}
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">
        {displayName}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {t('clan.memberJoined', { date: joined })}
      </span>
    </a>
  )
}
