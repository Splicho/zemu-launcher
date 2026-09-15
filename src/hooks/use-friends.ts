import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'

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
