/**
 * Party (in-game lobby group) hooks for the desktop launcher.
 *
 * Talks to the game server's `/api/party/*` endpoints via
 * `dispatchParty` (see `src/lib/party.ts`). Mirror of `useFriends`
 * — single query for the current party state, mutations for each
 * party action. Polls while a group or invite exists per the
 * LAUNCHER-API doc:
 *
 *   "GET /api/party: every 2-3 s while a group or an invite exists."
 *
 * The hook returns the same `PartyState` the server emits so the
 * React panel can read `state.canAct` and per-friend `atMenu` for
 * invite-button gating. The action mutations (`invite / accept /
 * decline / kick / leave`) all invalidate the `party` query on
 * settle, so a successful / refused action never leaves the panel
 * showing stale membership.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'

import {
  dispatchParty,
  type PartyAction,
  type PartyActionResult,
  type PartyRequestPayload,
  type PartyState,
} from '@/lib/party'

export const partyKeys = {
  all: ['party'] as const,
  state: () => [...partyKeys.all, 'state'] as const,
}

const FAST_POLL_MS = 2_500
const IDLE_POLL_MS = 18_000

/**
 * Fetches the current party state. Polls fast (2.5 s) while the
 * player is in a group or has an outstanding invite; backs off to
 * 18 s when no activity so we don't spend the user's bandwidth on
 * empty rooms.
 *
 * `enabled` should reflect both "the user is signed in" AND "the
 * user has a ZEmu auth key saved" — otherwise the polling layer
 * fires 401s every interval.
 */
export function useParty(
  options: { enabled?: boolean } = {},
): UseQueryResult<PartyActionResult, Error> {
  const enabled = options.enabled ?? false
  return useQuery({
    queryKey: partyKeys.state(),
    queryFn: async () => {
      const result = await dispatchParty('get')
      return result
    },
    enabled,
    refetchInterval: (query) => {
      const data = query.state.data as PartyActionResult | undefined
      if (!data || !data.ok) return IDLE_POLL_MS
      // Fast-poll while there's anything to react to.
      const hasGroup = data.partyId !== 0 && data.members.length > 0
      const hasInvite = data.invitesIn.length > 0 || data.invitesOut.length > 0
      return hasGroup || hasInvite ? FAST_POLL_MS : IDLE_POLL_MS
    },
    refetchIntervalInBackground: false,
    staleTime: 1_000,
  })
}

/** Pull the most recent `PartyState` out of the query cache without
 *  forcing a refetch. Returns the default empty state when no
 *  query has run yet (e.g. in tests / SSR). */
export function readPartyState(qc: ReturnType<typeof useQueryClient>): PartyState | null {
  const cached = qc.getQueryData<PartyActionResult>(partyKeys.state())
  if (!cached || !cached.ok) return null
  return {
    partyId: cached.partyId,
    leaderId: cached.leaderId,
    isLeader: cached.isLeader,
    members: cached.members,
    invitesIn: cached.invitesIn,
    invitesOut: cached.invitesOut,
    canAct: cached.canAct,
    startStaged: cached.startStaged,
  }
}

function usePartyMutation(
  action: PartyAction,
): UseMutationResult<PartyActionResult, Error, PartyRequestPayload> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: PartyRequestPayload) =>
      dispatchParty(action, payload),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: partyKeys.all })
    },
  })
}

/** Invite a player (by id) to the current group. Caller is
 *  responsible for the in-game menu gate — this hook just sends the
 *  request and returns the server's verdict. */
export function usePartyInvite() {
  return usePartyMutation('invite')
}

/** Accept a pending invite. With no `targetId`, the server picks
 *  the one waiting invite; with `targetId`, accepts the named
 *  leader's invite. */
export function usePartyAccept() {
  return usePartyMutation('accept')
}

/** Decline a pending invite (same shape as accept). */
export function usePartyDecline() {
  return usePartyMutation('decline')
}

/** Leader-only: remove a player from the group. */
export function usePartyKick() {
  return usePartyMutation('kick')
}

/** Leave the current group. */
export function usePartyLeave() {
  return usePartyMutation('leave')
}
