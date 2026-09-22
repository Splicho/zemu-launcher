/**
 * Subscribes to the `friends:presence-updated` Tauri event emitted by
 * the Rust realtime socket client and patches the cached friends graph
 * in place so the avatar-badge dot + "Currently playing" sub-line
 * update without a full refetch.
 *
 * The hook is mounted from `main-app.tsx` (not inside FriendsPanel) so
 * it fires even when the panel is closed. It is gated by the
 * `enabled` boolean so it is a no-op when the user is not authenticated.
 *
 * Stale-handling:
 *   The Rust socket forwards `presence:updated` verbatim from the
 *   api, which means it can carry a row older than the api's 90s
 *   staleness window. The renderer mirrors the api: anything older
 *   than 90s gets projected to `offline` so a friend whose
 *   heartbeat stopped doesn't appear stuck "online" forever.
 *
 * Cache keys:
 *   The hook writes to `friendsKeys.graph()` (the same key the
 *   FriendsPanel reads). It also touches the `search` keys because
 *   the search results panel reuses the same `Friend` shape and a
 *   friend who appears in a search hit deserves the same status
 *   update. The graph is the primary path; the search patches are
 *   a best-effort convenience.
 */
import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { useQueryClient } from '@tanstack/react-query'

import { friendsKeys } from '@/hooks/use-friends'
import type { FriendsGraph, FriendStatus } from '@/lib/friends'

/** Mirrors `api/src/realtime/realtime.notifier.ts`'s payload. */
export interface FriendsPresenceUpdatedPayload {
  userId: string
  status: 'online' | 'in_game' | 'away' | 'busy'
  currentGame: string | null
  lastSeenAt: string
}

/**
 * Staleness window, in milliseconds. Must match the api's
 * `STALE_AFTER_MS` in `presence/presence.service.ts`. A row older
 * than this is treated as `'offline'` regardless of what the api
 * says — keeps the launcher and api in lock-step without a shared
 * constant module.
 */
const STALE_AFTER_MS = 90_000

/** FriendStatus union used by the renderer. */
const FRIEND_STATUS_VALUES: readonly FriendStatus[] = [
  'online',
  'away',
  'busy',
  'in_game',
  'offline',
] as const

function narrowStatus(value: unknown): FriendStatus {
  for (const candidate of FRIEND_STATUS_VALUES) {
    if (candidate === value) return candidate
  }
  return 'offline'
}

/**
 * Subscribe to `friends:presence-updated` and patch the cached graph.
 *
 * @param enabled - pass `true` when the user is authenticated.
 *   The hook is a no-op when `enabled` is `false`.
 */
export function useFriendsPresence(enabled: boolean) {
  const qc = useQueryClient()

  useEffect(() => {
    if (!enabled) return

    const unlistenP = listen<FriendsPresenceUpdatedPayload>(
      'friends:presence-updated',
      (event) => {
        const { userId, status, currentGame, lastSeenAt } = event.payload
        if (!userId) return

        const ageMs = Date.now() - new Date(lastSeenAt).getTime()
        const projected: FriendStatus =
          ageMs > STALE_AFTER_MS ? 'offline' : narrowStatus(status)
        const projectedCurrentGame =
          projected === 'offline' ? null : currentGame

        // Patch the graph cache. We touch every list because the
        // same user id can appear in `friends` (accepted), and a
        // future flow may surface them in `incoming` / `outgoing`
        // before acceptance.
        qc.setQueryData<FriendsGraph | undefined>(
          friendsKeys.graph(),
          (prev) => {
            if (!prev) return prev
            return {
              ...prev,
              self: patchFriend(prev.self, userId, projected, projectedCurrentGame, lastSeenAt),
              friends: prev.friends.map((f) =>
                f.id === userId
                  ? patchFriend(f, userId, projected, projectedCurrentGame, lastSeenAt)!
                  : f,
              ),
              incoming: prev.incoming.map((f) =>
                f.id === userId
                  ? patchFriend(f, userId, projected, projectedCurrentGame, lastSeenAt)!
                  : f,
              ),
              outgoing: prev.outgoing.map((f) =>
                f.id === userId
                  ? patchFriend(f, userId, projected, projectedCurrentGame, lastSeenAt)!
                  : f,
              ),
            }
          },
        )
      },
    )

    return () => {
      void unlistenP.then((fn) => fn())
    }
  }, [enabled, qc])
}

function patchFriend(
  friend: FriendsGraph['friends'][number] | null,
  userId: string,
  status: FriendStatus,
  currentGame: string | null,
  lastSeenAt: string,
) {
  if (!friend || friend.id !== userId) return friend
  return {
    ...friend,
    status,
    currentGame,
    lastSeenAt,
  }
}
