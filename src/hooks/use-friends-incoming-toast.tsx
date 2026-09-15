/**
 * Subscribes to the `friends:incoming-request` Tauri event emitted by the
 * Rust realtime socket client and shows a custom Sonner toast with
 * Accept / Decline inline action buttons.
 *
 * The hook is mounted from `main-app.tsx` (not inside FriendsPanel) so
 * it fires even when the panel is closed. It is gated by the
 * `enabled` boolean so it is a no-op when the user is not authenticated.
 *
 * De-duplication: a `Set<string>` in a `useRef` tracks the last 20
 * `fromUser.id`s. If the same user sends a duplicate request (server
 * race or realtime double-send) the second event is silently dropped.
 */
import { useEffect, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import { toast } from 'sonner'

import { useFriendsAccept, useFriendsDecline } from '@/hooks/use-friends'
import { FriendRequestToast } from '@/components/friends/friend-request-toast'

/** Max size of the de-duplication set. */
const DEDUP_CAP = 20

export interface FriendsIncomingRequestPayload {
  fromUser: {
    id: string
    displayName: string | null
    avatarUrl: string | null
  }
}

/**
 * Subscribe to `friends:incoming-request` and show a toast.
 *
 * @param enabled - pass `true` when the user is authenticated.
 *   The hook is a no-op when `enabled` is `false`.
 */
export function useFriendsIncomingToast(enabled: boolean) {
  const accept = useFriendsAccept()
  const decline = useFriendsDecline()

  /** De-duplication set — keyed by sender userId. */
  const seenIds = useRef(new Set<string>())

  useEffect(() => {
    if (!enabled) {
      // Clear the set when the user logs out so a fresh session starts clean.
      seenIds.current.clear()
      return
    }

    const unlistenP = listen<FriendsIncomingRequestPayload>(
      'friends:incoming-request',
      (event) => {
        const { fromUser } = event.payload
        const userId = fromUser.id

        // De-duplicate.
        if (seenIds.current.has(userId)) return
        seenIds.current.add(userId)
        if (seenIds.current.size > DEDUP_CAP) {
          // Evict the oldest entry when the set grows past the cap.
          const first = seenIds.current.values().next().value
          if (first !== undefined) seenIds.current.delete(first)
        }

        const dismiss = (toastId: string | number) =>
          toast.dismiss(toastId)

        toast.custom(
          (toastId) => (
            <FriendRequestToast
              toastId={toastId}
              fromUser={fromUser}
              acceptPending={accept.isPending}
              declinePending={decline.isPending}
              onAccept={(id) =>
                accept.mutate(
                  { targetId: id },
                  {
                    onSettled: () => dismiss(toastId),
                  },
                )
              }
              onDecline={(id) =>
                decline.mutate(
                  { targetId: id },
                  {
                    onSettled: () => dismiss(toastId),
                  },
                )
              }
              onDismiss={dismiss}
            />
          ),
          {
            duration: Infinity,
            position: 'bottom-right',
            unstyled: true,
            classNames: { toast: 'cn-toast' },
          },
        )
      },
    )

    return () => {
      void unlistenP.then((fn) => fn())
      seenIds.current.clear()
    }
  }, [enabled, accept, decline])
}
