/**
 * Friends API client for the desktop launcher.
 *
 * Talks directly to the website's `/v1/friends/*` endpoints (the
 * zemu-website NestJS api) over HTTPS, authenticated with the
 * launcher's bearer token persisted in localStorage. The Tauri
 * IPC stub that previously sat at `window.friendsAPI.dispatch`
 * is gone — every friends action is a plain HTTP call now.
 *
 * Why this replaces the stub:
 *   - The friends graph is hosted in the central zemu-website
 *     Postgres, not in any launcher-local state. Round-tripping
 *     through a Rust command would have meant re-implementing
 *     every endpoint on the Rust side anyway.
 *   - The auth app + api already speak the same Auth.js session
 *     AND the launcher's bearer JWT (`LAUNCHER_TOKEN_SECRET`).
 *     The api's `/v1/friends/*` accepts either via the
 *     `AuthedUser` decorator pair (`SessionGuard` +
 *     `LauncherBearerGuard`).
 *
 * Error model:
 *   - Non-2xx responses raise an Error with the server's `error`
 *     / message field as `message`. The caller catches in a
 *     single place (`dispatchFriends`) and surfaces a typed
 *     `FriendsActionResult` with `ok: false`.
 *   - Network failures (Tauri webview blocked the request, DNS
 *     failed) raise a `TypeError` from `fetch`; we map that to
 *     `reason: 'network_error'`.
 *   - Missing / expired bearer — the api returns 401. We surface
 *     `reason: 'unauthenticated'` so the launcher's `useAuth`
 *     hook can sign the user out.
 */

import { readPersistedToken } from '@/lib/auth'
import { LAUNCHER_CONFIG } from '@/config/launcher'

// ─── URL resolution (mirrors src/lib/news.ts) ─────────────────────────────
//
// Single source of truth for where to send `/v1/friends/*` calls.
// All four API consumers (friends, news, streams, leaderboard) share
// `VITE_API_URL`, which points at the root of the api server.
//
// Precedence (first wins):
//   1. `VITE_API_URL` set in `.env.local` — Vite exposes this only
//      at dev-time, so production bundles ignore it entirely.
//   2. `LAUNCHER_CONFIG.friendsApiBaseUrl` — the bundled default,
//      `https://api.zemu.uk` in published builds.

function resolveFriendsApiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_URL as string | undefined
  if (import.meta.env.DEV && fromEnv) return fromEnv
  return LAUNCHER_CONFIG.friendsApiBaseUrl
}

const FRIENDS_API_BASE = resolveFriendsApiBaseUrl()
const FRIENDS_API_BASE_LOOKS_DEV = /localhost|127\.0\.0\.1|tauri\.localhost/.test(
  FRIENDS_API_BASE,
)
console.log(
  `[friends] base URL = ${FRIENDS_API_BASE} ${FRIENDS_API_BASE_LOOKS_DEV ? '(dev)' : '(PROD!)'}`,
)
if (import.meta.env.DEV && !FRIENDS_API_BASE_LOOKS_DEV) {
  console.warn(
    '[friends] DEV mode but VITE_API_URL is not set — every friends call will hit production. ' +
      'Add VITE_API_URL=http://localhost:3002 to zemu-launcher/.env.local',
  )
}

export type FriendStatus = 'online' | 'away' | 'busy' | 'in_game' | 'offline'

/**
 * The launcher's relationship lexicon. Matches the
 * `relationState` field returned by the friends api one-for-one;
 * `normalizeFriendRelationship` collapses an unknown server value
 * to `'none'` so the rest of the UI keeps working when a future
 * kind is added.
 */
export type FriendRelationship =
  | 'self'
  | 'friend'
  | 'incoming'
  | 'outgoing'
  | 'none'

export interface Friend {
  id: string
  displayName: string | null
  avatarUrl: string | null
  country: string | null
  /** ISO timestamp the friendship was accepted. Null for pending / search hits. */
  friendsSince: string | null
  /**
   * Server-provided relation snapshot. The launcher keeps its own
   * copy because search-result rows carry this on the hit itself
   * (see `FriendSearchHit.relationState`).
   */
  relationship: FriendRelationship
  /** Synthesized on the client from a server-side status field when present. */
  status: FriendStatus
}

export interface FriendSearchHit extends Friend {
  /** Relation between the caller and this player. */
  relationState: FriendRelationship
}

export interface FriendsGraph {
  self: Friend | null
  friends: Friend[]
  incoming: Friend[]
  outgoing: Friend[]
  /**
   * Last search results. Stays populated until the next
   * `list` / `refresh`. Empty until the launcher actually
   * invokes a search.
   */
  results: FriendSearchHit[]
}

export interface FriendsActionResult extends FriendsGraph {
  ok: boolean
  reason?: string | null
}

export type FriendsAction =
  | 'list'
  | 'search'
  | 'request'
  | 'accept'
  | 'decline'
  | 'cancel'
  | 'remove'
  | 'profile'

export interface FriendsRequestPayload {
  /** Target player ID, when applicable. */
  targetId?: string
  /** New display name, when applicable. */
  displayName?: string
  /** Search query, when applicable. */
  query?: string
}

const DEFAULT_GRAPH: FriendsGraph = {
  self: null,
  friends: [],
  incoming: [],
  outgoing: [],
  results: [],
}

// ─── API client ───────────────────────────────────────────────────────────

/**
 * Read the bearer token from localStorage. Returns `null` when
 * the user is signed out — the call sites translate that into
 * `reason: 'unauthenticated'`.
 */
function getBearer(): string | null {
  const token = readPersistedToken()
  return token?.token ?? null
}

/**
 * Single HTTP shim. Adds the bearer header, decodes JSON, and
 * raises an Error on non-2xx. Returns `null` as a "401 specifically"
 * signal so the dispatch layer can branch on it.
 *
 * One console.log per request (URL+method on the way out,
 * status+ms on the way back) so the launcher DevTools console
 * tells the whole story of a friends call without us needing to
 * attach the webview debugger.
 */
async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const base = FRIENDS_API_BASE
  const bearer = getBearer()
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (bearer) {
    headers.set('Authorization', `Bearer ${bearer}`)
  }
  const url = `${base}${path}`
  const startedAt = performance.now()
  console.log(`[friends] → ${method} ${url}`)
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      headers,
      credentials: 'omit',
    })
  } catch (networkError) {
    console.error(
      `[friends] fetch threw for ${method} ${path}`,
      networkError,
    )
    throw networkError
  }
  const elapsed = Math.round(performance.now() - startedAt)
  const text = await response.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }
  console.log(
    `[friends] ← ${response.status} ${method} ${path} (${elapsed}ms)`,
  )
  if (response.status === 401) {
    console.warn('[friends] 401 — token missing or expired')
    return null as T
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object'
        ? String(
            (payload as { error?: unknown; message?: unknown }).error ??
              (payload as { message?: unknown }).message ??
              '',
          )
        : ''
    console.error(
      `[friends] HTTP ${response.status} ${method} ${path}:`,
      message,
    )
    throw new Error(message || `HTTP ${response.status}`)
  }
  return payload as T
}

// ─── Wire → UI normalization ──────────────────────────────────────────────

export function normalizeFriendStatus(value: unknown): FriendStatus {
  if (
    value === 'online' ||
    value === 'away' ||
    value === 'busy' ||
    value === 'in_game' ||
    value === 'offline'
  ) {
    return value
  }
  return 'offline'
}

export function normalizeFriendRelationship(value: unknown): FriendRelationship {
  if (
    value === 'self' ||
    value === 'friend' ||
    value === 'incoming' ||
    value === 'outgoing' ||
    value === 'none'
  ) {
    return value
  }
  return 'none'
}

function normalizeFriend(value: unknown, relationOverride?: FriendRelationship): Friend | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const id =
    typeof raw.id === 'string'
      ? raw.id
      : typeof raw.friendUserId === 'string'
        ? raw.friendUserId
        : typeof raw.otherUserId === 'string'
          ? raw.otherUserId
          : ''
  if (!id) return null
  const displayName =
    typeof raw.displayName === 'string'
      ? raw.displayName
      : typeof raw.friendDisplayName === 'string'
        ? raw.friendDisplayName
        : typeof raw.otherDisplayName === 'string'
          ? raw.otherDisplayName
          : null
  const avatarUrl =
    typeof raw.avatarUrl === 'string'
      ? raw.avatarUrl
      : typeof raw.friendAvatarUrl === 'string'
        ? raw.friendAvatarUrl
        : typeof raw.otherAvatarUrl === 'string'
          ? raw.otherAvatarUrl
          : null
  const country =
    typeof raw.country === 'string'
      ? raw.country
      : typeof raw.friendCountry === 'string'
        ? raw.friendCountry
        : typeof raw.otherCountry === 'string'
          ? raw.otherCountry
          : null
  const friendsSince =
    typeof raw.friendsSince === 'string'
      ? raw.friendsSince
      : typeof raw.sentAt === 'string'
        ? raw.sentAt
        : null
  const relationship = relationOverride
    ?? normalizeFriendRelationship(
        raw.relationship ?? raw.relationState,
      )
  return {
    id,
    displayName,
    avatarUrl,
    country,
    friendsSince,
    relationship,
    status: normalizeFriendStatus(raw.status),
  }
}

function normalizeFriendList(value: unknown, relationOverride?: FriendRelationship): Friend[] {
  if (!Array.isArray(value)) return []
  const out: Friend[] = []
  for (const item of value) {
    const friend = normalizeFriend(item, relationOverride)
    if (friend) out.push(friend)
  }
  return out
}

function normalizeSearchHits(value: unknown): FriendSearchHit[] {
  if (!Array.isArray(value)) return []
  const out: FriendSearchHit[] = []
  for (const item of value) {
    const hit = normalizeFriend(item)
    if (!hit) continue
    const raw = item as Record<string, unknown>
    out.push({
      ...hit,
      relationState: normalizeFriendRelationship(raw.relationState),
    })
  }
  return out
}

function normalizeGraph(value: unknown): FriendsGraph {
  if (!value || typeof value !== 'object') return DEFAULT_GRAPH
  const raw = value as Record<string, unknown>
  return {
    self: normalizeFriend(raw.self),
    friends: normalizeFriendList(raw.friends, 'friend'),
    incoming: normalizeFriendList(raw.incoming, 'incoming'),
    outgoing: normalizeFriendList(raw.outgoing, 'outgoing'),
    results: normalizeSearchHits(raw.results ?? raw.users),
  }
}

function normalizeResult(value: unknown): FriendsActionResult {
  const graph = normalizeGraph(value)
  if (!value || typeof value !== 'object') {
    return { ...graph, ok: false, reason: 'unknown' }
  }
  const raw = value as Record<string, unknown>
  return {
    ...graph,
    ok: raw.ok === true,
    reason: typeof raw.reason === 'string' ? raw.reason : null,
  }
}

// ─── Action dispatcher ────────────────────────────────────────────────────

/**
 * Single entry point used by every React hook. Maps the React-
 * level action discriminator to one (or more) HTTP calls and
 * returns a normalized `FriendsActionResult`.
 *
 * The `ok: false` shape is returned (not thrown) so the React
 * panel can render an inline error message instead of catching
 * errors through TanStack Query's error boundary.
 */
export async function dispatchFriends(
  action: FriendsAction,
  payload: FriendsRequestPayload = {},
): Promise<FriendsActionResult> {
  try {
    if (action === 'list' || action === 'profile') {
      // Fetch all three lists in parallel; the launcher's Graph
      // panel renders friends / incoming / outgoing side by side, so
      // the cheapest way to keep them in sync is one round trip per
      // list. Each endpoint is a single indexed scan; the total
      // is bounded by the user's actual relationships.
      const [friendsPage, incomingPage, outgoingPage] = await Promise.all([
        apiFetch<{ friends: unknown[] }>('/v1/friends'),
        apiFetch<{ requests: unknown[] }>(
          '/v1/friends/requests/incoming',
        ),
        apiFetch<{ requests: unknown[] }>(
          '/v1/friends/requests/outgoing',
        ),
      ])
      if (
        friendsPage === null ||
        incomingPage === null ||
        outgoingPage === null
      ) {
        return failureResult('unauthenticated')
      }
      return normalizeResult({
        friends: friendsPage.friends,
        incoming: incomingPage.requests,
        outgoing: outgoingPage.requests,
        ok: true,
      })
    }
    if (action === 'search') {
      const query = (payload.query ?? '').trim()
      if (query.length < 2) {
        return { ...DEFAULT_GRAPH, ok: true, reason: null }
      }
      const value = await apiFetch<{
        users: unknown[]
      }>(
        `/v1/friends/search-users?q=${encodeURIComponent(query)}&limit=10`,
      )
      if (value === null) return failureResult('unauthenticated')
      const hits = (value.users ?? []) as unknown[]
      return normalizeResult({
        ...value,
        friends: [],
        incoming: [],
        outgoing: [],
        results: hits,
        ok: true,
      })
    }
    if (action === 'request') {
      const targetId = payload.targetId
      if (!targetId) {
        return failureResult('missing_target')
      }
      const body = await apiFetch<{ id: string; autoAccepted?: boolean }>(
        `/v1/friends/requests/${encodeURIComponent(targetId)}`,
        { method: 'POST' },
      )
      if (body === null) return failureResult('unauthenticated')
      // Re-fetch the graph so the panel reflects the new pending row.
      const graph = await apiFetch<{
        friends: unknown[]
      }>('/v1/friends')
      return normalizeResult({ ...graph, ok: true })
    }
    if (action === 'accept') {
      const fromUserId = payload.targetId
      if (!fromUserId) {
        return failureResult('missing_target')
      }
      await apiFetch<unknown>(
        `/v1/friends/requests/${encodeURIComponent(fromUserId)}/accept`,
        { method: 'POST' },
      )
      const graph = await apiFetch<{
        friends: unknown[]
      }>('/v1/friends')
      return normalizeResult({ ...graph, ok: true })
    }
    if (action === 'decline') {
      const fromUserId = payload.targetId
      if (!fromUserId) {
        return failureResult('missing_target')
      }
      await apiFetch<unknown>(
        `/v1/friends/requests/${encodeURIComponent(fromUserId)}/decline`,
        { method: 'POST' },
      )
      const graph = await apiFetch<{ friends: unknown[] }>(
        '/v1/friends',
      )
      return normalizeResult({ ...graph, ok: true })
    }
    if (action === 'cancel') {
      const toUserId = payload.targetId
      if (!toUserId) {
        return failureResult('missing_target')
      }
      await apiFetch<unknown>(
        `/v1/friends/requests/${encodeURIComponent(toUserId)}`,
        { method: 'DELETE' },
      )
      const graph = await apiFetch<{ friends: unknown[] }>(
        '/v1/friends',
      )
      return normalizeResult({ ...graph, ok: true })
    }
    if (action === 'remove') {
      const otherUserId = payload.targetId
      if (!otherUserId) {
        return failureResult('missing_target')
      }
      await apiFetch<unknown>(
        `/v1/friends/requests/${encodeURIComponent(otherUserId)}`,
        {
          method: 'DELETE',
          body: JSON.stringify({ kind: 'friend' }),
        },
      )
      const graph = await apiFetch<{ friends: unknown[] }>(
        '/v1/friends',
      )
      return normalizeResult({ ...graph, ok: true })
    }
    return failureResult('unknown_action')
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'unknown'
    const reason = message.includes('Failed to fetch')
      ? 'network_error'
      : message
    return failureResult(reason)
  }
}

function failureResult(reason: string): FriendsActionResult {
  return {
    ...DEFAULT_GRAPH,
    ok: false,
    reason,
  }
}
