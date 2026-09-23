import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useState } from 'react'

import {
  dispatchFriends,
  invalidateFriendsEtag,
  isNotModifiedResult,
  type FriendsAction,
  type FriendsActionResult,
  type FriendsRequestPayload,
} from '@/lib/friends'
import { friendsDebugLog } from '@/lib/zemu-game-api'

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
 * Returns `true` once the launcher has a ZEmu auth key saved on
 * disk. The friends / party / avatar clients all require it; pass
 * the result into each hook's `enabled` flag so a fresh user with
 * no key yet isn't peppered with 401s and "unauthenticated" toasts.
 *
 * The check is cheap (`launcherAPI.getAuthKey()` is a single
 * in-process Rust call) but `enabled` gates still want the value
 * to settle before the polling layer kicks in — the initial
 * `null` is expected on cold start.
 */
export function useZemuAuthKeyReady(enabled: boolean = true): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !window.launcherAPI?.getAuthKey) {
      setReady(false)
      return
    }
    let cancelled = false
    void window.launcherAPI
      .getAuthKey()
      .then((key) => {
        if (cancelled) return
        setReady(typeof key === 'string' && key.length > 0)
      })
      .catch(() => {
        if (cancelled) return
        setReady(false)
      })
    return () => {
      cancelled = true
    }
  }, [enabled])
  return ready
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
 * Fetches the full friends graph (self + lists).
 *
 * Defaults to a 3-5 s `refetchInterval` per the LAUNCHER-API doc —
 * the game server has no push channel, so a tight poll is the only
 * way the UI sees new requests / presence changes. Callers can
 * override via `options.refetchInterval`; pass `false` to disable
 * polling (e.g. when the panel is closed and a slower tray-level
 * poller takes over).
 *
 * ETag handling: `dispatchFriends('list')` returns a sentinel
 * (recognised via `isNotModifiedResult`) on a 304 not-modified
 * response. We use TanStack's queryCache to replay the *previous*
 * cache entry by reference, so the panel never re-renders with
 * the empty `DEFAULT_GRAPH` shape. If there's no prior cache yet
 * (cold start, session restore across page reloads, panel
 * closed-and-reopened, etc.) we drop the stored etag and issue
 * an unconditional refetch — the cold-cache case is the bug
 * described in detail below.
 */
export function useFriendsGraph(
  options: {
    enabled?: boolean
    refetchInterval?: number | false
  } = {},
): UseQueryResult<FriendsActionResult, Error> {
  const { enabled, refetchInterval } = options
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: friendsKeys.graph(),
    queryFn: async () => {
      const result = await dispatchFriends('list')
      if (isNotModifiedResult(result)) {
        const prior = queryClient.getQueryData<FriendsActionResult>(
          friendsKeys.graph(),
        )
        if (prior && prior.ok) return prior
        // COLD-CACHE 304 LEAK: sessionStorage persists the
        // friends-list ETag across the launcher's page reloads
        // and across the panel closing-and-reopening, but
        // TanStack's in-memory cache only lives for the current
        // QueryClient instance. The two stores can drift — if
        // the user has an ETag in storage from a prior session
        // but no `data` cached yet for this QueryClient, the
        // dispatcher's 304 sentinel leaks past the
        // replay-guard above (`prior` is `undefined`) and
        // becomes the cached `data` for the lifetime of the
        // mount. The panel then paints "Something went wrong.
        // (__not_modified__)" forever even though the server
        // *correctly* told us "no changes".
        //
        // The dispatcher is the only layer with access to the
        // 304 response, so we drop the stored etag here and
        // issue an unconditional refetch through the dispatcher
        // again. The unconditional probe can return 200/4xx/5xx
        // but not 304 (no `If-None-Match` was sent), so it will
        // always produce a cacheable result.
        console.warn(
          '[friends] cold-cache 304 — forcing unconditional refetch',
        )
        void friendsDebugLog.log(
          'friends',
          'cold-cache 304 — forcing unconditional refetch (cleared stored etag)',
        )
        // Wipe the stored etag *outside* of the dispatcher
        // because the dispatcher's 304 branch holds a reference
        // to the etag store via the closure; calling
        // `dispatchFriends` again is fine because the second
        // call will load whatever the store returns (now `null`).
        // We import the etag store via the dispatcher's module
        // itself rather than reach into private helpers — the
        // dispatcher owns that detail.
        await invalidateFriendsEtag()
        return dispatchFriends('list')
      }
      return result
    },
    enabled: enabled ?? false,
    refetchInterval: refetchInterval ?? 4_000,
    refetchIntervalInBackground: false,
    staleTime: 2_000,
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

/** Derived count of incoming (pending) friend requests.
 *
 * The cached graph is a `FriendsActionResult` (extends `FriendsGraph`,
 * which carries `incoming: Friend[]` directly — there is no `.graph`
 * wrapper). Reading `data.graph?.incoming` always returned `undefined`
 * here, so the sidebar badge stayed at 0 even when the graph had
 * pending requests. Keep this in lock-step with `useFriendsGraph`'s
 * return type; if a future refactor reshapes the cache, this hook must
 * be updated or the badge regresses silently.
 *
 * `enabled` should be `true` only when the user is signed in AND has
 * saved a ZEmu auth key — otherwise the badge either stays at 0
 * forever (the friends graph never loads) or fires a 401 every
 * interval. */
export function useIncomingRequestsCount(options: { enabled?: boolean } = {}): number {
  const { data } = useFriendsGraph({
    enabled: options.enabled ?? true,
    refetchInterval: 18_000,
  })
  return data?.ok ? data.incoming.length : 0
}
