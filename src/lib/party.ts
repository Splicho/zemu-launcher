/**
 * Party (in-game lobby group) client for the desktop launcher.
 *
 * Talks to the game server's `/api/party/*` endpoints over plain
 * HTTP. See `LAUNCHER-API (1).md` for the full contract. The party
 * lives in the game's lobby — these routes drive the same group
 * the in-game panel shows, so the caller's game must be running
 * AND at the main menu for any `invite` / `accept` to succeed.
 *
 * Auth: `Authorization: Bearer <ZEmu auth key>` (same key the
 * friends client uses — see `zemu-game-api.ts`).
 *
 * Endpoint map:
 *   `GET    /api/party`             — current party, if any
 *   `POST   /api/party/invite`      — `{ id | name }` of player
 *   `POST   /api/party/accept`      — `{ id | name }` of leader, or
 *                                    empty body for the one waiting
 *                                    invite
 *   `POST   /api/party/decline`     — same as accept
 *   `POST   /api/party/kick`        — `{ id | name }`
 *   `POST   /api/party/leave`       — empty body
 *
 * All responses are JSON with the `PartyState` shape (see below).
 * On a refused action the response is still HTTP 200, with
 * `ok: false` and a `reason`; the documentation lists:
 *   - `you_are_not_at_the_menu`
 *   - `player_is_offline`
 *   - `player_is_not_at_the_menu`
 *   - `no_pending_invite`
 *   - `player_not_found`
 *   - `refused` (+ a readable `message`)
 *
 * The `canAct` and `friend.atMenu` flags gate the invite button —
 * greyed out unless both are true. Polling pattern matches the
 * friends client: 2-3 s while a group or invite exists.
 */
import { gameFetch, GameApiError, getZemuAuthKey, mapGameApiAuthReason } from '@/lib/zemu-game-api'
import type { Friend } from '@/lib/friends'
import { normalizeFriend } from '@/lib/friends'

// ─── Wire types ──────────────────────────────────────────────────────────

/**
 * Shape returned by `/api/party`. Mirrors the doc verbatim.
 * `members` / `invitesIn` / `invitesOut` reuse the `Friend` type
 * from `friends.ts` (same entity, same server).
 */
export interface PartyState {
  partyId: number
  leaderId: string | null
  isLeader: boolean
  members: Friend[]
  invitesIn: Friend[]
  invitesOut: Friend[]
  /**
   * False when the caller's game isn't at the main menu. The
   * React panel greys out the invite button unless this is true.
   */
  canAct: boolean
  /**
   * True while the leader has pressed START and members are being
   * pulled in. The panel hides the leave button during this
   * window (you'll get punted anyway) and shows a "Match starting"
   * indicator instead.
   */
  startStaged: boolean
}

export interface PartyActionResult extends PartyState {
  ok: boolean
  reason?: string | null
  message?: string | null
}

export type PartyAction =
  | 'get'
  | 'invite'
  | 'accept'
  | 'decline'
  | 'kick'
  | 'leave'

export interface PartyRequestPayload {
  /**
   * Target player id, when applicable. The server accepts either
   * `{ id }` or `{ name }`; we always send `id` (the launcher's
   * existing friend / search-hit rows already carry one).
   */
  targetId?: string
}

const DEFAULT_PARTY: PartyState = {
  partyId: 0,
  leaderId: null,
  isLeader: false,
  members: [],
  invitesIn: [],
  invitesOut: [],
  canAct: false,
  startStaged: false,
}

// ─── Normalisation ───────────────────────────────────────────────────────

function normalizeFriendList(value: unknown): Friend[] {
  if (!Array.isArray(value)) return []
  const out: Friend[] = []
  for (const item of value) {
    const friend = normalizeFriend(item)
    if (friend) out.push(friend)
  }
  return out
}

function normalizeParty(value: unknown): PartyState {
  if (!value || typeof value !== 'object') return DEFAULT_PARTY
  const raw = value as Record<string, unknown>
  return {
    partyId: typeof raw.partyId === 'number' ? raw.partyId : 0,
    leaderId: typeof raw.leaderId === 'string' ? raw.leaderId : null,
    isLeader: raw.isLeader === true,
    members: normalizeFriendList(raw.members),
    invitesIn: normalizeFriendList(raw.invitesIn),
    invitesOut: normalizeFriendList(raw.invitesOut),
    canAct: raw.canAct === true,
    startStaged: raw.startStaged === true,
  }
}

function normalizeResult(value: unknown): PartyActionResult {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_PARTY, ok: false, reason: 'unknown' }
  }
  const raw = value as Record<string, unknown>
  return {
    ...normalizeParty(value),
    ok: raw.ok === true,
    reason: typeof raw.reason === 'string' ? raw.reason : null,
    message: typeof raw.message === 'string' ? raw.message : null,
  }
}

// ─── Failure helpers ─────────────────────────────────────────────────────

function unauthenticatedResult(): PartyActionResult {
  return { ...DEFAULT_PARTY, ok: false, reason: 'unauthenticated' }
}

function networkErrorResult(): PartyActionResult {
  return { ...DEFAULT_PARTY, ok: false, reason: 'network_error' }
}

// ─── Dispatcher ──────────────────────────────────────────────────────────

/**
 * Issue one party action against the game server. Mirrors the
 * shape of `dispatchFriends` for symmetry — returns the result
 * rather than throwing on refused-action shapes.
 */
export async function dispatchParty(
  action: PartyAction,
  payload: PartyRequestPayload = {},
): Promise<PartyActionResult> {
  const authKey = await getZemuAuthKey()
  if (!authKey) return unauthenticatedResult()

  try {
    switch (action) {
      case 'get': {
        const result = await gameFetch<unknown>('/api/party', { silent: true })
        return normalizeResult(result)
      }

      case 'leave': {
        const result = await gameFetch<unknown>('/api/party/leave', {
          method: 'POST',
        })
        return normalizeResult(result)
      }

      case 'invite':
      case 'accept':
      case 'decline':
      case 'kick': {
        const targetId = payload.targetId
        // `accept` / `decline` accept an empty body (matches the
        // one waiting invite when no `name` / `id` is given).
        const body =
          targetId && action !== 'accept' && action !== 'decline'
            ? JSON.stringify({ id: targetId })
            : undefined
        const result = await gameFetch<unknown>(
          `/api/party/${action}`,
          {
            method: 'POST',
            body,
            headers: body
              ? { 'Content-Type': 'application/json' }
              : undefined,
          },
        )
        return normalizeResult(result)
      }

      default:
        return { ...DEFAULT_PARTY, ok: false, reason: 'unknown_action' }
    }
  } catch (error) {
    if (error instanceof GameApiError) {
      // Same 401 taxonomy as the friends client — see
      // `mapGameApiAuthReason` for the four cases.
      if (error.status === 401) {
        return { ...DEFAULT_PARTY, ok: false, reason: mapGameApiAuthReason(error) }
      }
      return {
        ...DEFAULT_PARTY,
        ok: false,
        reason: `api_error:${error.status}`,
      }
    }
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('Failed to fetch') || message.includes('network')) {
      return networkErrorResult()
    }
    console.warn(`[party] ${action} failed`, message)
    return { ...DEFAULT_PARTY, ok: false, reason: 'unknown' }
  }
}
