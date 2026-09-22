import * as React from 'react'

import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { FriendStatus } from '@/lib/friends'
import { STATUS_DOT_CLASS } from '@/components/friends/status-dot-class'

/** Narrow interface — only the fields `PlayerResultRow` actually needs. */
interface PersonLike {
  id: string
  displayName?: string | null
  avatarUrl?: string | null
  status: string
  currentGame?: string | null
}

interface PlayerResultRowProps<T extends PersonLike> {
  person: T
  children?: React.ReactNode
}

export function PlayerResultRow<T extends PersonLike>({
  person,
  children,
}: PlayerResultRowProps<T>) {
  const { t } = useTranslation()
  const status = (person.status as FriendStatus) ?? 'offline'
  const showGameLine = status === 'in_game' && person.currentGame
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
            STATUS_DOT_CLASS[status] ?? STATUS_DOT_CLASS.offline,
            'ring-2 ring-popover',
          )}
        />
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-tight">
          {person.displayName}
        </p>
        {showGameLine ? (
          <p
            className="truncate text-xs leading-tight text-amber-500"
            aria-label={t('friends.status.currentlyPlaying', {
              game: person.currentGame,
            })}
          >
            {t('friends.status.currentlyPlaying', {
              game: person.currentGame,
            })}
          </p>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
