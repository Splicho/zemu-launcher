import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'

import { AvatarStack, type AvatarStackItem } from '@/components/friends/avatar-stack'
import { cn } from '@/lib/utils'

interface FriendRequestsRowProps {
  /** People whose avatars we stack — typically the incoming list. */
  people: readonly AvatarStackItem[]
  /** Number of pending requests; shown as a chip on the right. */
  count: number
  onClick: () => void
  className?: string
}

/**
 * Compact entry point shown above the friends list. The avatars of
 * the people who sent the user a request are stacked on the left,
 * followed by the "Friend requests" label and the pending count.
 * Clicking anywhere on the row opens the dedicated Friend requests
 * page.
 */
export function FriendRequestsRow({
  people,
  count,
  onClick,
  className,
}: FriendRequestsRowProps) {
  const { t } = useTranslation()
  const disabled = count === 0
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'group flex w-full items-center gap-3 rounded-md px-2.5 py-2.5 text-left transition-colors',
        disabled
          ? 'cursor-default opacity-60'
          : 'hover:bg-muted/40',
        className,
      )}
      aria-label={t('friends.friendRequests')}
    >
      <AvatarStack people={people} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium leading-tight">
        {t('friends.friendRequests')}
      </span>
      {count > 0 ? (
        <span
          className={cn(
            'min-w-5 rounded-full border border-border bg-secondary px-2 py-0.5 text-center text-[11px] font-semibold leading-none tabular-nums text-secondary-foreground shadow-sm',
          )}
        >
          {count}
        </span>
      ) : null}
      <ChevronRight
        className={cn(
          'size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out group-hover:translate-x-1',
          disabled && 'opacity-0 group-hover:translate-x-0',
        )}
        aria-hidden="true"
      />
    </button>
  )
}
