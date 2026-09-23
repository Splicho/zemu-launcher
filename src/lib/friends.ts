/**
 * Friends API client. Desktop requests go through Rust to avoid WebView CORS;
 * browser previews use fetch. Both transports use the persisted launcher
 * bearer and share the same response normalization and action dispatch.
 */

import { readPersistedToken } from '@/lib/auth'
import { httpFetch } from '@/lib/http-fetch'
import { LAUNCHER_CONFIG } from '@/config/launcher'
import { invoke, isTauri } from '@tauri-apps/api/core'

// ─── Friends debug log bridge ───────────────────────────────────────────
//
// Thin shim around the Rust `friends_debug_log_*` commands. Every
// friends system call writes a line to `%APPDATA%\com.zemuuk.launcher
// \friendlist-debug.log` so we can reproduce any user-reported bug
// without rerunning it under the webview debugger.
//
// When we're not running inside Tauri (`isTauri()` is false, e.g.
// `vite dev` in a plain browser tab), the helper falls back to
// `console.log` so dev-time console monitoring keeps working.

async function flog(source: string, message: string): Promise<void> {
  const line = `[${source}] ${message}`
  if (!isTauri()) {
    console.log(`[friendlist-debug] ${line}`)
    return
  }
  try {
    await invoke('friends_debug_log_write', { source, message })
  } catch {
    // Best-effort — never propagate log-write failures.
  }
}

async function flogPath(): Promise<string | null> {
  if (!isTauri()) return null
  try {
    return (await invoke<string>('friends_debug_log_path')) ?? null
  } catch {
    return null
  }
}

export const friendsDebugLog = {
  log: flog,
  getPath: flogPath,
}

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
  /**
   * Synthesized on the client from a server-side status field when
   * present. The launcher's renderer treats missing / stale values
   * as `'offline'` (see `useFriendsPresence` for the realtime
   * patcher that drives updates after the initial fetch).
   */
  status: FriendStatus
  /**
   * Free-form game label set by the friend's launcher's heartbeat.
   * Non-null only when `status === 'in_game'`; the renderer shows
   * "Currently playing <currentGame>" under the display name.
   */
  currentGame: string | null
  /**
   * ISO timestamp the presence row was last written. Used to render
   * "last seen 2 minutes ago" copy when the row is stale.
   */
  lastSeenAt: string | null
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
 * Single HTTP shim. Sends authenticated requests through Rust on desktop,
 * decodes JSON, and raises an Error on non-2xx, including unauthenticated
 * for 401. Successful empty responses (e.g. DELETE 204) return null.
 *
 * One console.log per request (URL+method on the way out,
 * status+ms on the way back) so the launcher DevTools console
 * tells the whole story of a friends call without us needing to
 * attach the webview debugger.
 */
async function apiFetch<T>(
  path: string,
  init: { method?: 'GET' | 'POST' | 'DELETE'; body?: string } = {},
): Promise<T> {
  const base = FRIENDS_API_BASE
  const bearer = getBearer()
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers()
  headers.set('Accept', 'application/json')
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (bearer) {
    headers.set('Authorization', `Bearer ${bearer}`)
  }
  const url = `${base.replace(/\/+$/, '')}${path}`
  const startedAt = performance.now()
  console.log(`[friends] → ${method} ${url}`)
  void flog(
    'http',
    `→ ${method} ${path} bearer=${bearer ? 'yes' : 'no'}`,
  )
  let status: number
  let text: string
  try {
    const response = await httpFetch(url, {
      ...init,
      headers,
      redirect: 'error',
    })
    status = response.status
    text = await response.text()
  } catch (networkError) {
    const errMsg =
      networkError instanceof Error ? networkError.message : String(networkError)
    console.error(
      `[friends] fetch threw for ${method} ${path}`,
      networkError,
    )
    void flog('http', `× ${method} ${path} network_error err=${errMsg}`)
    // The shared transport rejects network failures; retain the friends UI's
    // error code without retrying mutations.
    throw new Error('network_error')
  }
  const elapsed = Math.round(performance.now() - startedAt)
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }
  console.log(
    `[friends] ← ${status} ${method} ${path} (${elapsed}ms)`,
  )
  void flog(
    'http',
    `← ${status} ${method} ${path} (${elapsed}ms)`,
  )
  if (status === 401) {
    console.warn('[friends] 401 — token missing or expired')
    void flog('http', `401 unauthenticated for ${method} ${path}`)
    throw new Error('unauthenticated')
  }
  if (status < 200 || status >= 300) {
    const message =
      payload && typeof payload === 'object'
        ? String(
            (payload as { error?: unknown; message?: unknown }).error ??
              (payload as { message?: unknown }).message ??
              '',
          )
        : ''
    console.error(
      `[friends] HTTP ${status} ${method} ${path}:`,
      message,
    )
    void flog(
      'http',
      `✗ HTTP ${status} ${method} ${path} message=${message}`,
    )
    throw new Error(message || `HTTP ${status}`)
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
  const status = normalizeFriendStatus(raw.status ?? raw.friendStatus)
  // The api's friend-list DTO carries `friendCurrentGame` and
  // `friendLastSeenAt`; search hits use `currentGame` / `lastSeenAt`.
  // The renderer treats missing values as "no presence" and projects
  // to its own `'offline'` UI state.
  const currentGame =
    typeof raw.currentGame === 'string'
      ? raw.currentGame
      : typeof raw.friendCurrentGame === 'string'
        ? raw.friendCurrentGame
        : null
  const lastSeenAt =
    typeof raw.lastSeenAt === 'string'
      ? raw.lastSeenAt
      : typeof raw.friendLastSeenAt === 'string'
        ? raw.friendLastSeenAt
        : null
  return {
    id,
    displayName,
    avatarUrl,
    country,
    friendsSince,
    relationship,
    status,
    currentGame,
    lastSeenAt,
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
      await apiFetch<{ id: string; autoAccepted?: boolean }>(
        `/v1/friends/requests/${encodeURIComponent(targetId)}`,
        { method: 'POST' },
      )
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
