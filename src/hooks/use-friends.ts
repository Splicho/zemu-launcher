import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { listen } from '@tauri-apps/api/event'
import { useEffect } from 'react'

import {
  dispatchFriends,
  type FriendsAction,
  type FriendsActionResult,
  type FriendsRequestPayload,
} from '@/lib/friends'

/**
 * Query keys for the friends surface. Kept as a const so every hook
 * and the Sheet wrapper agree on the same invalidation prefix — the
 * Sheet invalidates `['friends']` (any depth) after every successful
 * mutation so the panel refreshes without re-fetching unrelated data.
 */
export const friendsKeys = {
  all: ['friends'] as const,
  graph: () => [...friendsKeys.all, 'graph'] as const,
  search: (query: string) => [...friendsKeys.all, 'search', query] as const,
}

/**
 * Subscribes to the `friends:graph-changed` Tauri event emitted by the Rust
 * realtime socket client (`src-tauri/src/friends_realtime.rs`). When
 * received, invalidates the whole friends cache so the FriendsPanel
 * re-fetches without polling.
 *
 * Call this once in the component tree that owns the FriendsPanel.
 * No-ops outside of Tauri (the event listener is a no-op in a browser).
 *
 * @param enabled - pass `true` when the user is logged in and the
 *   friends panel may be shown. Prevents unnecessary event listeners
 *   for logged-out users.
 */
export function useFriendsRealtimeSync(enabled: boolean) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!enabled) return

    const unlistenPromise = listen('friends:graph-changed', () => {
      // Mark the friends cache as stale so the next time any component
      // reads it (e.g. the sidebar badge re-renders, the user opens
      // the Friends panel) it fetches fresh data. We use
      // `refetchType: 'none'` to avoid racing with a server-side write
      // that may not have committed yet — the `useFriendsIncomingToast`
      // hook optimistically bumps the incoming count immediately, so the
      // badge shows the new request without waiting for a round-trip.
      void qc.invalidateQueries({
        queryKey: friendsKeys.all,
        refetchType: 'none',
      })
    })

    return () => {
      void unlistenPromise.then((unlisten) => unlisten())
    }
  }, [enabled, qc])
}

/**
 * Fetches the full friends graph (self + lists). We `enabled: false`
 * by default so callers control when the fetch fires — typically once
 * the Friends sheet opens — to avoid hitting the stub on every page.
 */
export function useFriendsGraph(
  options: { enabled?: boolean } = {},
): UseQueryResult<FriendsActionResult, Error> {
  return useQuery({
    queryKey: friendsKeys.graph(),
    queryFn: async () => {
      const result = await dispatchFriends('list')
      return result
    },
    enabled: options.enabled ?? false,
  })
}

/**
 * Runs a friends search. Mirrors the reference behaviour: we only
 * fire the request once the query is at least 2 characters long
 * (matching the input's `minLength={2}`), otherwise we short-circuit
 * with an empty result set.
 */
export function useFriendsSearch(
  query: string,
  options: { enabled?: boolean } = {},
): UseQueryResult<FriendsActionResult, Error> {
  const trimmed = query.trim()
  const enabled = (options.enabled ?? true) && trimmed.length >= 2

  return useQuery<FriendsActionResult, Error>({
    queryKey: friendsKeys.search(trimmed),
    queryFn: async () => {
      return dispatchFriends('search', { query: trimmed })
    },
    enabled,
  })
}

/**
 * Single mutation helper that wraps a friends action and invalidates
 * the whole friends cache on success. The five exported action hooks
 * below are thin wrappers so the React panel can call e.g.
 * `friendsRequest.mutate({ targetId })` directly.
 */
function useFriendsMutation(
  action: FriendsAction,
): UseMutationResult<FriendsActionResult, Error, FriendsRequestPayload> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: FriendsRequestPayload) =>
      dispatchFriends(action, payload),
    onSuccess: () => {
      // Refetch graph + any active searches. The action's response
      // already carries the new graph, but invalidating guarantees
      // we re-sync if another part of the UI changed in parallel.
      void queryClient.invalidateQueries({ queryKey: friendsKeys.all })
    },
  })
}

/** Send a friend request to `targetId`. */
export function useFriendsRequest() {
  return useFriendsMutation('request')
}

/** Accept an incoming friend request from `targetId`. */
export function useFriendsAccept() {
  return useFriendsMutation('accept')
}

/** Decline an incoming friend request from `targetId`. */
export function useFriendsDecline() {
  return useFriendsMutation('decline')
}

/** Cancel an outgoing friend request to `targetId`. */
export function useFriendsCancel() {
  return useFriendsMutation('cancel')
}

/** Remove an existing friend `targetId`. */
export function useFriendsRemove() {
  return useFriendsMutation('remove')
}

/** Derived count of incoming (pending) friend requests. */
export function useIncomingRequestsCount(options: { enabled?: boolean } = {}): number {
  const { data } = useFriendsGraph({ enabled: options.enabled ?? true })
  return data?.ok ? (data.graph?.incoming?.length ?? 0) : 0
}
