import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  X,
  Send,
  UserMinus,
  UserPlus,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Check } from '@/components/icons'
import { cn } from '@/lib/utils'

interface ActionBaseProps {
  /** Target user id — kept on each component so callers don't have to
   *  thread it through a render-prop. */
  targetId: string
  onAction: (targetId: string) => void
  disabled?: boolean
  /** Extra classes for the wrapper <div> (used to stack two buttons
   *  side by side in the incoming-request row). */
  className?: string
  pending?: boolean
  /** True once the mutation has finished — used to swap the icon from
   *  spinner to a "done" check. */
  done?: boolean
}

/**
 * Friend is already a connection — show a single destructive "Remove"
 * button.
 */
export function RemoveFriendAction({
  targetId,
  onAction,
  disabled,
}: ActionBaseProps) {
  const { t } = useTranslation()
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => onAction(targetId)}
      disabled={disabled}
      aria-label={t('friends.actions.remove')}
      className="text-muted-foreground hover:text-destructive"
    >
      <UserMinus className="!size-4" aria-hidden="true" />
      <span className="sr-only">{t('friends.actions.remove')}</span>
    </Button>
  )
}

/**
 * Accept (checkmark) + Decline (cross) shown side by side for an
 * incoming friend request.
 */
export function AcceptDeclineActions({
  targetId,
  onAccept,
  onDecline,
  disabled,
  className,
}: {
  targetId: string
  onAccept: (targetId: string) => void
  onDecline: (targetId: string) => void
  disabled?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <div className={cn('flex gap-1', className)}>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => onAccept(targetId)}
        disabled={disabled}
        aria-label={t('friends.actions.accept')}
        className="text-muted-foreground hover:text-emerald-500"
      >
        <Check className="!size-4" aria-hidden="true" />
        <span className="sr-only">{t('friends.actions.accept')}</span>
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => onDecline(targetId)}
        disabled={disabled}
        aria-label={t('friends.actions.decline')}
        className="text-muted-foreground hover:text-destructive"
      >
        <X className="!size-4" aria-hidden="true" />
        <span className="sr-only">{t('friends.actions.decline')}</span>
      </Button>
    </div>
  )
}

/**
 * Outgoing friend request — a single "Cancel request" button (paper
 * plane).
 */
export function CancelRequestAction({
  targetId,
  onAction,
  disabled,
}: ActionBaseProps) {
  const { t } = useTranslation()
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => onAction(targetId)}
      disabled={disabled}
      aria-label={t('friends.actions.cancel')}
      className="text-muted-foreground hover:text-foreground"
    >
      <Send className="!size-4" aria-hidden="true" />
      <span className="sr-only">{t('friends.actions.cancel')}</span>
    </Button>
  )
}

/**
 * No relation yet — a primary "Add friend" icon button.
 */
export function AddFriendAction({
  targetId,
  onAction,
  disabled,
  pending,
  done,
}: ActionBaseProps) {
  const { t } = useTranslation()
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => onAction(targetId)}
      disabled={disabled || pending || done}
      aria-label={t('friends.actions.add')}
      className="text-muted-foreground"
    >
      {pending ? (
        <Spinner className="!size-4" aria-hidden="true" />
      ) : done ? (
        <Check className="!size-4 text-emerald-500" aria-hidden="true" />
      ) : (
        <UserPlus className="!size-4" aria-hidden="true" />
      )}
      <span className="sr-only">{t('friends.actions.add')}</span>
    </Button>
  )
}

export type FriendAction =
  | 'add'
  | 'remove'
  | 'accept'
  | 'decline'
  | 'cancel'

interface FriendActionBarProps {
  /** Resolves the relationship between the current user and `person`
   *  — `'self'` means "skip this row entirely". */
  relation: 'self' | 'friend' | 'incoming' | 'outgoing' | 'none'
  targetId: string
  request: { mutate: (args: { targetId: string }, options?: { onSuccess?: () => void; onError?: () => void }) => void }
  accept: { mutate: (args: { targetId: string }) => void }
  decline: { mutate: (args: { targetId: string }) => void }
  cancel: { mutate: (args: { targetId: string }) => void }
  remove: { mutate: (args: { targetId: string }) => void }
  disabled?: boolean
}

/**
 * Single dispatcher component — pick the right buttons for the
 * current relationship and render them. Callers no longer have to
 * write a `renderActions` function for every section.
 */
export function FriendActionBar({
  relation,
  targetId,
  request,
  accept,
  decline,
  cancel,
  remove,
  disabled,
}: FriendActionBarProps) {
  const { t } = useTranslation()
  /** Per-row pending/done state so the spinner and success check
   *  animate on **this** row only — the mutation's global
   *  `isPending`/`isSuccess` would otherwise affect every row in the
   *  list when one click fires. */
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [doneId, setDoneId] = useState<string | null>(null)
  if (relation === 'self') return null
  if (relation === 'friend')
    return (
      <RemoveFriendAction
        targetId={targetId}
        onAction={(id) => remove.mutate({ targetId: id })}
        disabled={disabled}
      />
    )
  if (relation === 'incoming')
    return (
      <AcceptDeclineActions
        targetId={targetId}
        onAccept={(id) => accept.mutate({ targetId: id })}
        onDecline={(id) => decline.mutate({ targetId: id })}
        disabled={disabled}
      />
    )
  if (relation === 'outgoing')
    return (
      <CancelRequestAction
        targetId={targetId}
        onAction={(id) => cancel.mutate({ targetId: id })}
        disabled={disabled}
      />
    )
  return (
    <AddFriendAction
      targetId={targetId}
      onAction={(id) => {
        setPendingId(id)
        request.mutate(
          { targetId: id },
          {
            onSuccess: () => {
              setPendingId(null)
              setDoneId(id)
              toast.success(t('friends.actions.requestSent'))
            },
            onError: () => {
              setPendingId(null)
            },
          },
        )
      }}
      disabled={disabled}
      pending={pendingId === targetId}
      done={doneId === targetId}
    />
  )
}
