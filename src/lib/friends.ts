/**
 * Friends API client for the desktop launcher.
 *
 * Talks to the game server's `/api/friends` endpoints over plain
 * HTTP (see `LAUNCHER-API (1).md`). The full URL is fixed in
 * `zemu-game-api.ts` — it is the same server that runs the game on
 * port 8126.
 *
 * Auth: `Authorization: Bearer <ZEmu auth key>` — the same 0x + 16
 * hex digit key the launcher hands to the game at launch. Pulled
 * from `window.launcherAPI.getAuthKey()` via `getZemuAuthKey()`.
 * NOT the OAuth JWT — the game server has no idea what
 * `id.zemu.uk` is and rejects the wrong token with a 401.
 *
 * Wire shape (matches the doc verbatim):
 *   `GET /api/friends` → `FriendsGraph` (+ `ETag` header; 304 on
 *                          matching `If-None-Match`).
 *   `GET /api/friends/search?q=<query>` → `FriendsGraph` with `results`
 *                          populated, no `incoming`/`outgoing`/`friends`.
 *   `POST /api/friends/{action} { id | name }` → `FriendsActionResult`
 *                          where action ∈ request | accept | decline |
 *                          cancel | remove. Refusals come back as
 *                          2xx with `ok: false` and a `reason`
 *                          string. We forward those verbatim.
 *   `PUT /api/friends/profile` → always `{ ok: false,
 *                          reason: 'display_name_is_the_in_game_name' }`
 *                          (the server enforces in-game name as
 *                          the displayed name).
 *
 * Error model:
 *   - Network failure (DNS / refused / offline) → `fetch` throws;
 *     we map to `reason: 'network_error'`.
 *   - `GameApiError` 4xx/5xx → `reason: 'api_error:<status>'` so the
 *     panel can branch on a typed shape.
 *   - No auth key saved → we don't even call; surface
 *     `reason: 'unauthenticated'` so the upstream `useFriends` can
 *     render the "set your auth key" CTA instead of the panel.
 *
 * The `useFriendsGraph` polling layer persists the latest
 * `etag` header in `sessionStorage` and re-attaches it as
 * `If-None-Match` on the next `list` call. On a 304, the cached
 * `FriendsGraph` is returned without touching React state — this
 * keeps the friends panel's 3-5 s poll under 100 bytes per round
 * when nothing has changed.
 */
import {
  gameFetch,
  gameFetchWithEtag,
  GameApiError,
  friendsDebugLog,
  getZemuAuthKey,
  GAME_API_BASE_URL,
  mapGameApiAuthReason,
} from '@/lib/zemu-game-api'

// ─── Types ───────────────────────────────────────────────────────────────

export type FriendStatus = 'online' | 'in_game' | 'offline'

/**
 * The launcher's relationship lexicon. Matches the `relationship`
 * field on `Friend` from the game server one-for-one. Unknown values
 * are coerced to `'none'` by `normalizeFriendRelationship`.
 */
export type FriendRelationship =
  | 'self'
  | 'friend'
  | 'incoming'
  | 'outgoing'
  | 'none'

/**
 * A single friend row, as returned by `/api/friends`. The doc adds
 * fields the original webhook-driven loader didn't track
 * (`lastSeen`, `activity`, `atMenu`, `partyId`) — kept here so the
 * UI can render them when they're meaningful (e.g. per-row invite
 * gating on `atMenu`).
 */
export interface Friend {
  id: string
  displayName: string
  /**
   * Resolved absolute URL for the friend's avatar image on the game
   * server, or `null` when they have no icon uploaded. The server
   * returns relative paths (`/avatar/<id>`); we prefix the game API
   * base URL during normalisation.
   */
  avatarUrl: string | null
  /**
   * ISO 3166-1 alpha-2 country code from the directory, when present.
   * Optional in the wire payload; the renderer treats `null` as
   * "no country chip".
   */
  country: string | null
  /**
   * ISO timestamp the friendship was accepted. Null for pending /
   * search hits (the game server doesn't carry this — accepted
   * requests don't have a separate "since" timestamp in the wire
   * format; we default to null and the renderer can re-derive from
   * `lastSeen` if needed).
   */
  friendsSince: string | null
  relationship: FriendRelationship
  status: FriendStatus
  /**
   * Free-form mode label set by the friend's game while
   * `status === 'in_game'` (e.g. "Solos", "Duos", "Fives"). Null
   * otherwise.
   */
  currentGame: string | null
  /**
   * ISO 8601 UTC timestamp the friend was last seen connected to
   * the game server. Null while `status` is online / in_game, and
   * for a player who's never been on (the doc's "last seen"
   * semantics).
   */
  lastSeen: string | null
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
   * `list` / `refresh` / `search`. Empty until the launcher actually
   * invokes a search.
   */
  results: FriendSearchHit[]
  /**
   * `true` when the backend already knows the player's display
   * name (e.g. via the in-game directory) and the panel should hide
   * the "set your name" form. The game server always returns
   * `true` — the in-game name IS the displayed name on this server.
   */
  directoryConfigured: boolean
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
  /** Target player id (decimal-string from `Friend.id`). */
  targetId?: string
  /** New display name, when applicable (the profile action). */
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
  directoryConfigured: true,
}

// ─── Wire normalisation ──────────────────────────────────────────────────

/**
 * The game server may return `avatarUrl` as a relative path
 * (`/avatar/<id>`) per the doc, or already absolute depending on
 * proxy hops. Resolve to an absolute URL on the game server so the
 * `<img>` tag can render without the component caring which case
 * we got.
 */
function resolveAvatarUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  if (/^https?:/i.test(value)) return value
  if (value.startsWith('/')) return `${GAME_API_BASE_URL}${value}`
  return `${GAME_API_BASE_URL}/${value}`
}

export function normalizeFriendStatus(value: unknown): FriendStatus {
  if (value === 'online' || value === 'in_game' || value === 'offline') {
    return value
  }
  // Doc says `online | in_game | offline` only — anything else
  // (`'menu'` / `'in_match'` legacy, junk) projects to `offline`.
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

export function normalizeFriend(value: unknown): Friend | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const id = typeof raw.id === 'string' ? raw.id : ''
  if (!id) return null
  return {
    id,
    displayName: typeof raw.displayName === 'string' ? raw.displayName : '',
    avatarUrl: resolveAvatarUrl(raw.avatarUrl),
    country: typeof raw.country === 'string' ? raw.country : null,
    friendsSince:
      typeof raw.friendsSince === 'string' ? raw.friendsSince : null,
    relationship: normalizeFriendRelationship(raw.relationship),
    status: normalizeFriendStatus(raw.status),
    currentGame:
      typeof raw.activity === 'string'
        ? raw.activity
        : typeof raw.currentGame === 'string'
          ? raw.currentGame
          : null,
    lastSeen:
      typeof raw.lastSeen === 'string'
        ? raw.lastSeen
        : typeof raw.lastSeenAt === 'string'
          ? raw.lastSeenAt
          : null,
  }
}

function normalizeFriendList(
  value: unknown,
  relationOverride: FriendRelationship,
): Friend[] {
  if (!Array.isArray(value)) return []
  const out: Friend[] = []
  for (const item of value) {
    const friend = normalizeFriend(item)
    if (!friend) continue
    friend.relationship = relationOverride
    out.push(friend)
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
      relationState: normalizeFriendRelationship(
        raw.relationState ?? raw.relationship,
      ),
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
    results: normalizeSearchHits(raw.results),
    directoryConfigured:
      typeof raw.directoryConfigured === 'boolean'
        ? raw.directoryConfigured
        : true,
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

// ─── Action dispatcher ───────────────────────────────────────────────────

function defaultFailure(): FriendsActionResult {
  return { ...DEFAULT_GRAPH, ok: false, reason: 'unknown' }
}

/**
 * Internal-only sentinel returned from `dispatchFriends('list')` and
 * `dispatchFriends('search')` to signal "the request succeeded but
 * nothing new came back" (a 304 on the polling endpoint, or a
 * malformed search payload). The hook layer (`useFriendsGraph`) is
 * the only thing that should read this — UI code is expected to
 * never see it, because the hook either replays the prior cache or
 * discards the result before React sees it. We prefix it with `__`
 * and pick a name that's not a valid translation key so even if it
 * *does* leak through, the panel's `resolveReason` helper falls
 * back to a generic message rather than a specific one.
 */
export const NOT_MODIFIED_REASON = '__not_modified__'

export function isNotModifiedResult(
  result: FriendsActionResult | null | undefined,
): boolean {
  return (
    !!result &&
    result.ok === true &&
    result.reason === NOT_MODIFIED_REASON
  )
}

function unauthenticatedFailure(): FriendsActionResult {
  return { ...DEFAULT_GRAPH, ok: false, reason: 'unauthenticated' }
}

function networkErrorFailure(): FriendsActionResult {
  return { ...DEFAULT_GRAPH, ok: false, reason: 'network_error' }
}

/** Per-account ETag cache. Keyed by ZEmu auth key so a sign-out /
 *  sign-in as a different user doesn't leak the previous user's
 *  conditional-GET cursor. In `sessionStorage` so it doesn't
 *  survive a launcher restart (the in-memory cache is meaningless
 *  after a cold start anyway — first `list` after restart will be
 *  an unconditional GET that seeds a fresh ETag). */
const ETAG_STORAGE_PREFIX = 'zemu-launcher.friends.etag.'

function loadStoredEtag(authKey: string): string | null {
  try {
    return sessionStorage.getItem(ETAG_STORAGE_PREFIX + authKey)
  } catch {
    return null
  }
}

function saveStoredEtag(authKey: string, etag: string | null): void {
  try {
    if (etag) sessionStorage.setItem(ETAG_STORAGE_PREFIX + authKey, etag)
    else sessionStorage.removeItem(ETAG_STORAGE_PREFIX + authKey)
  } catch {
    // sessionStorage may be unavailable in private mode.
  }
}

/**
 * Drop the stored conditional-GET cursor for the *current* user's
 * auth key. Exported so the polling hook (`useFriendsGraph`) can
 * detect the cold-cache 304 case — where the dispatcher hands back
 * `NOT_MODIFIED_REASON` for a 304 but the query cache has no prior
 * entry to replay against — and force the next request to be
 * unconditional. The second call will seed a fresh etag (or
 * surface a real 4xx/5xx), unblocking the panel.
 *
 * Calling with no signed-in key is a no-op; the dispatcher's
 * unauthenticated path returns its own `reason` without ever
 * touching the etag store.
 */
export async function invalidateFriendsEtag(): Promise<void> {
  const authKey = await getZemuAuthKey()
  if (!authKey) return
  saveStoredEtag(authKey, null)
}

/**
 * Issue one friends action against the game server.
 *
 * The shape of the returned `FriendsActionResult` is intentionally
 * identical to the previous (zemu-website / NestJS) implementation
 * so the React panel doesn't need any rewiring. The only caller-
 * visible difference is the `reason` vocabulary, which now mirrors
 * the LAUNCHER-API doc strings verbatim (`player_not_found`,
 * `already_friends`, `already_requested`, `no_pending_request`,
 * `not_friends`, `friend_limit_reached`, `pending_limit_reached`,
 * plus the runner-up `unauthenticated` / `network_error` /
 * `not_implemented` we map from the local auth- and transport-
 * level guards).
 *
 * Catching strategy: 4xx/5xx `GameApiError`s are mapped to
 * `reason: 'api_error:<status>'` so the panel can fall back to
 * the generic "unknown" copy rather than throwing through the
 * TanStack Query error boundary. Calls inside the React layer
 * (`useFriendsGraph`'s `queryFn`, the mutation hooks) handle the
 * `ok: false` shape as a regular state update — no try/catch at
 * the call sites.
 */
export async function dispatchFriends(
  action: FriendsAction,
  payload: FriendsRequestPayload = {},
): Promise<FriendsActionResult> {
  const authKey = await getZemuAuthKey()
  if (!authKey) {
    // Distinct log marker so an "unauthenticated friends panel" is
    // trivial to spot in the debug log — without it, the panel's
    // "Please sign in to manage friends" copy and the generic
    // "Something went wrong." surface from the same `ok: false`
    // shape and a support engineer has to read the resolver chain
    // to tell them apart.
    void friendsDebugLog.log('friends', `dispatch[${action}] no auth key — returning unauthenticated`)
    return unauthenticatedFailure()
  }

  try {
    switch (action) {
      case 'list':
      case 'profile': {
        // Per the doc, `profile` is `PUT /api/friends/profile` and
        // always returns `{ ok: false, reason:
        // 'display_name_is_the_in_game_name' }`. We forward that
        // shape unchanged and don't try to take the rendered name
        // from anywhere else — the server enforces in-game-only
        // display names.
        if (action === 'profile') {
          const result = await gameFetch<unknown>('/api/friends/profile', {
            method: 'PUT',
            silent: true,
          })
          return normalizeResult(result)
        }

        const etag = loadStoredEtag(authKey)
        // Tracing the etag state at request time — if the user
        // just signed in (no stored etag yet) the request goes
        // out without `If-None-Match`, the server returns 200 +
        // a fresh body, and everything below is happy. If they
        // *do* have a stored etag and the server still returns
        // 200 (rather than 304) we'd double-paint; if the etag
        // is wrong-shaped (corrupted storage) the server may
        // respond with 412 Precondition Failed which surfaces
        // here as "Something went wrong." in the panel.
        void friendsDebugLog.log(
          'friends',
          `dispatch[list] authKey.len=${authKey.length} etag=${etag ? 'present' : 'absent'}`,
        )
        const { graph, etag: nextEtag } = await gameFetchWithEtag<unknown>(
          '/api/friends',
          etag,
        )
        if (graph === null) {
          // 304 — caller already has the latest. The polling hook
          // (`useFriendsGraph`) detects this sentinel via
          // `isNotModifiedResult` and replays the previous cache
          // entry so the panel's friend list never flashes empty
          // and the error-banner heuristic never sees a non-null
          // `reason` (which previously surfaced as "Something
          // went wrong." every refetch cycle). The sentinel is
          // marked `ok: true` so the sidebar's request-count
          // derivation, which reads `data.ok`, still treats the
          // cycle as successful.
          //
          // CAVEAT — cold-cache 304 leak: the hook's replay
          // guard (`prior && prior.ok`) silently drops this
          // sentinel when there's no prior cache, letting it
          // become the cached `data` for the lifetime of the
          // query. The panel then shows "Something went wrong.
          // (__not_modified__)" even though the server actually
          // said "no changes". The hook's
          // `queryFn` handles that path — it intercepts this
          // sentinel and issues an unconditional refetch on the
          // first cold-cache poll. This dispatcher stays
          // unchanged so the warm-cache polling rate stays at
          // one request per `refetchInterval` (not two).
          void friendsDebugLog.log(
            'friends',
            `dispatch[list] 304 not-modified (will be replayed or refetched by the hook)`,
          )
          return { ...DEFAULT_GRAPH, ok: true, reason: NOT_MODIFIED_REASON }
        }
        if (nextEtag) saveStoredEtag(authKey, nextEtag)
        const result = normalizeResult(graph)
        // The shape of `ok` + `reason` is the single most useful
        // piece of telemetry when the panel goes red: the panel
        // shows the localized copy (`result.reason` lookup),
        // but the raw string is opaque to the user. Logging it
        // here lets the debug-log reader see "the server said
        // `not_implemented`" rather than "Something went wrong."
        // (Both are the same colour on screen.)
        if (!result.ok) {
          void friendsDebugLog.log(
            'friends',
            `dispatch[list] server returned not-ok: reason=${result.reason ?? 'null'} friends.len=${result.friends.length}`,
          )
        }
        return result
      }

      case 'search': {
        const query = (payload.query ?? '').trim()
        if (query.length < 2) {
          return { ...DEFAULT_GRAPH, ok: true, reason: null }
        }
        const result = await gameFetch<unknown>(
          `/api/friends/search?q=${encodeURIComponent(query)}`,
          { silent: true },
        )
        if (!result || typeof result !== 'object') {
          // Treat any non-object payload as a successful empty
          // search — the `results: []` we return below already
          // covers "no players matched", and putting a non-null
          // reason here used to surface as "Something went wrong."
          // (the same banner fired on the 304 polling case; see
          // `NOT_MODIFIED_REASON` for the rationale).
          return { ...DEFAULT_GRAPH, ok: true, reason: null }
        }
        const raw = result as Record<string, unknown>
        const graph: FriendsGraph = {
          self: null,
          friends: [],
          incoming: [],
          outgoing: [],
          results: normalizeSearchHits(raw.results),
          directoryConfigured: true,
        }
        const okField = raw.ok
        return {
          ...graph,
          ok: okField === undefined ? true : okField === true,
          reason:
            typeof raw.reason === 'string' ? raw.reason : null,
        }
      }

      case 'request':
      case 'accept':
      case 'decline':
      case 'cancel':
      case 'remove': {
        const targetId = payload.targetId
        if (!targetId) {
          return { ...DEFAULT_GRAPH, ok: false, reason: 'missing_target' }
        }
        const httpMethod =
          action === 'cancel' || action === 'remove' ? 'POST' : 'POST'
        // The doc lists the verb as POST for every action; only the
        // path differs. Match that here.
        const body = JSON.stringify({ id: targetId })
        const result = await gameFetch<unknown>(
          `/api/friends/${action}`,
          {
            method: httpMethod,
            body,
            headers: { 'Content-Type': 'application/json' },
          },
        )
        return normalizeResult(result)
      }

      default:
        return { ...DEFAULT_GRAPH, ok: false, reason: 'unknown_action' }
    }
  } catch (error) {
    if (error instanceof GameApiError) {
      // The game server uses 401 for four distinct conditions —
      // see `mapGameApiAuthReason` for the breakdown. We only fall
      // back to the generic "unauthenticated" copy when the body
      // doesn't match one of the known reasons (defensive default
      // against future server-side additions).
      if (error.status === 401) {
        return { ...DEFAULT_GRAPH, ok: false, reason: mapGameApiAuthReason(error) }
      }
      return {
        ...DEFAULT_GRAPH,
        ok: false,
        reason: `api_error:${error.status}`,
      }
    }
    const message =
      error instanceof Error ? error.message : String(error)
    // Log to the structured debug channel too — the `console.warn`
      // is invisible in a packaged launcher with no DevTools
      // open, and the [friends] Something went wrong. banner the
      // user sees is colour-blind to the underlying cause. We
      // log BOTH the action and the raw message so a `grep
      // "dispatch\[\(request\|accept\|decline\|cancel\|remove\)\]"`
      // across the debug log ties each line back to the action
      // that triggered it.
    void friendsDebugLog.log(
      'friends',
      `dispatch[${action}] threw: status=${error instanceof GameApiError ? error.status : 'n/a'} msg=${message}`,
    )
    if (message.includes('Failed to fetch') || message.includes('network')) {
      return networkErrorFailure()
    }
    console.warn(`[friends] ${action} failed`, message)
    return defaultFailure()
  }
}
