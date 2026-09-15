/**
 * Custom Sonner toast body for an incoming friend request.
 * Owns all its own styling via `unstyled: true` on the Sonner call.
 * No props drilling from the parent — the hook passes mutation `isPending`
 * state directly so buttons reflect loading without re-rendering the card.
 */
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

export interface FriendRequestToastProps {
  /** Sonner passes this as the first argument to `toast.custom`'s render fn. */
  toastId: string | number
  fromUser: {
    id: string
    displayName: string | null
    avatarUrl: string | null
  }
  acceptPending: boolean
  declinePending: boolean
  onAccept: (userId: string) => void
  onDecline: (userId: string) => void
  onDismiss: (toastId: string | number) => void
}

/**
 * Card layout matching Epic / Steam toast conventions:
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ [Avatar]  <Name> sent you a friend request       [X]   │
 *   │           Decline                              [Accept] │
 *   └──────────────────────────────────────────────────────────┘
 */
export function FriendRequestToast({
  toastId,
  fromUser,
  acceptPending,
  declinePending,
  onAccept,
  onDecline,
  onDismiss,
}: FriendRequestToastProps) {
  const { t } = useTranslation()
  const displayName = fromUser.displayName ?? 'Unknown Player'
  const anyPending = acceptPending || declinePending

  const message = t('friends.toast.incomingRequest', { name: displayName })

  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-border bg-popover p-3 shadow-lg"
      style={{ minWidth: 300, maxWidth: 360 }}
    >
      {/* Avatar */}
      <Avatar className="size-10 shrink-0">
        {fromUser.avatarUrl ? (
          <AvatarImage src={fromUser.avatarUrl} alt={displayName} />
        ) : null}
        <AvatarFallback>
          {displayName.slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      {/* Text + actions */}
      <div className="min-w-0 flex-1">
        <p className="mb-2 pr-5 text-sm leading-snug text-popover-foreground">
          {message}
        </p>

        <div className="flex items-center gap-2">
          {/* Decline — left, secondary */}
          <Button
            variant="outline"
            size="sm"
            disabled={anyPending}
            onClick={() => onDecline(fromUser.id)}
            className="h-7 px-2 text-xs text-foreground"
          >
            {declinePending ? (
              <Spinner className="size-3" />
            ) : (
              t('friends.toast.decline')
            )}
          </Button>

          {/* Accept — right, gradient (matches FriendsPanel primary action) */}
          <Button
            variant="gradient"
            size="sm"
            disabled={anyPending}
            onClick={() => onAccept(fromUser.id)}
            className="h-7 px-3 text-xs"
          >
            {acceptPending ? (
              <Spinner className="size-3" />
            ) : (
              t('friends.toast.accept')
            )}
          </Button>
        </div>
      </div>

      {/* Dismiss */}
      <button
        onClick={() => onDismiss(toastId)}
        aria-label={t('common.close')}
        className="absolute right-2 top-2 rounded-sm p-1 text-muted-foreground opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        style={{ position: 'absolute', right: 8, top: 8 }}
      >
        <X className="size-3" />
      </button>
    </div>
  )
}
