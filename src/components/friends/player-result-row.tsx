import * as React from 'react'

import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import type { FriendStatus } from '@/lib/friends'

export const STATUS_DOT_CLASS: Record<FriendStatus, string> = {
  online: 'bg-emerald-500',
  in_game: 'bg-amber-500',
  busy: 'bg-rose-500',
  away: 'bg-yellow-400',
  offline: 'bg-zinc-500',
}

/** Narrow interface — only the fields `PlayerResultRow` actually needs. */
interface PersonLike {
  id: string
  displayName?: string | null
  avatarUrl?: string | null
  status: string
}

interface PlayerResultRowProps<T extends PersonLike> {
  person: T
  children?: React.ReactNode
}

export function PlayerResultRow<T extends PersonLike>({
  person,
  children,
}: PlayerResultRowProps<T>) {
  return (
    <div className="flex items-center gap-2.5 rounded-md px-2.5 py-2.5 transition-colors hover:bg-muted/40">
      <Avatar>
        {person.avatarUrl ? (
          <AvatarImage src={person.avatarUrl} alt="" />
        ) : null}
        <AvatarFallback>
          {(person.displayName ?? '?').slice(0, 1).toUpperCase()}
        </AvatarFallback>
        <AvatarBadge
          className={cn(
            STATUS_DOT_CLASS[person.status as FriendStatus] ??
              STATUS_DOT_CLASS.offline,
            'ring-2 ring-popover',
          )}
        />
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-tight">
          {person.displayName}
        </p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
