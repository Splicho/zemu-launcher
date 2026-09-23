/**
 * Clan reads for the public site.
 *
 * Endpoints under `api.zemu.uk/v1/clans`:
 *
 *   - GET /v1/clans/:slug/tooltip     → ClanProfile (full public payload)
 *   - GET /v1/clans/clantags?names=…  → ClanTagDto[] (batch)
 *   - GET /v1/clans?page=&limit=&q=&sort= → ClanDirectoryPage
 *   - GET /v1/clans/:slug/members     → paged member roster
 *   - GET /v1/clans/:slug/followers   → paged follower list
 *   - GET /v1/clans/:slug/founder     → founder badge
 *
 * Session-gated mutations (require the user's bearer token):
 *
 *   - POST   /v1/clans/:slug/follow
 *   - DELETE /v1/clans/:slug/follow
 *   - POST   /v1/clans/:slug/leave
 *   - POST   /v1/clans/:slug/request-join
 *
 * The `getTooltip` payload is the canonical public clan profile —
 * it carries the avatar, cover, description, counts, top-3
 * members, plus the fields the profile page needs to render the
 * full header + About tab (id, isPrivate, createdAt,
 * createdByUserId, joinQuestions).
 */

import { LAUNCHER_CONFIG } from '@/config/launcher'
import { fetchPublicApi } from '@/lib/public-api'
import { readPersistedToken } from '@/lib/auth'

function getClanApiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_URL as string | undefined
  if (import.meta.env.DEV && fromEnv) return `${fromEnv}/v1/clans`
  return LAUNCHER_CONFIG.friendsApiBaseUrl.replace(/\/$/, '') + '/v1/clans'
}

const CLAN_API_BASE = getClanApiBaseUrl()

// Re-export so the manage page can use the same base for the
// `search-users` endpoint without recomputing the URL.
export { CLAN_API_BASE }

/**
 * Resolve the absolute join-form URL for a given slug. The
 * launcher dialog uses this directly (the URL is the same
 * `CLAN_API_BASE` plus the slug + `/join-form`).
 */
export function getClanJoinFormUrl(slug: string): string {
  return `${CLAN_API_BASE}/${encodeURIComponent(slug)}/join-form`
}

export type ClanSort = 'members' | 'followers' | 'newest' | 'name'

export const CLAN_SORTS: readonly ClanSort[] = [
  'members',
  'followers',
  'newest',
  'name',
]

export interface ClanTooltipMember {
  displayName: string
  avatarUrl: string | null
}

/**
 * Single member cell on the public clan profile's Members tab.
 * Mirrors the website's `ClanMember` shape, projected from the
 * `clan_member` + `user` join.
 */
export interface ClanMember {
  userId: string
  displayName: string | null
  avatarUrl: string | null
  role: 'leader' | 'officer' | 'member'
  joinedAt: string
}

/**
 * Single follower cell on the public clan profile's Followers tab.
 * Mirrors the website's `ClanFollower` shape.
 */
export interface ClanFollower {
  userId: string
  displayName: string | null
  avatarUrl: string | null
  followedAt: string
}

/**
 * Founder badge displayed on the About tab's "Founded by" link.
 * `null` when the founder account has been deleted.
 */
export interface ClanFounderBadge {
  displayName: string | null
  avatarUrl: string | null
}

/**
 * Caller's relationship to this clan. `null` when the caller
 * isn't a member, the request is unauthenticated, or the tooltip
 * endpoint hasn't rolled out the membership field yet. Matches
 * the website's `ClanRole` so the launcher can render the
 * leader-only "Manage clan" CTA and gate the leave overflow.
 */
export type ClanRole = 'leader' | 'officer' | 'member'

/**
 * Clantag / clan name bounds. Mirrors the values used at the
 * website's action layer so the manage page's client-side
 * validation matches what the api will accept (defence in depth:
 * the api re-validates on PATCH /v1/clans/:slug, but a UI that
 * shows the rule inline keeps a user from typing a value the
 * server will reject).
 */
export const CLANTAG_MIN = 3
export const CLANTAG_MAX = 5
export const CLAN_NAME_MIN = 3
export const CLAN_NAME_MAX = 32

/**
 * Per-clan join-question definition. Mirrors the `JoinQuestion`
 * shape stored on `clan.join_questions` JSONB. Used by the
 * `Request to join` dialog to render the question schema lazily.
 */
export interface JoinQuestion {
  id: string
  label: string
  type: 'text' | 'textarea'
  placeholder?: string | null
  required: boolean
  maxLength?: number | null
}

/**
 * Extended public clan profile. Returned by the tooltip endpoint
 * — same shape the website's `getClanBySlug` projects to the page.
 * Includes everything needed to render the full header (cover,
 * avatar, identity row, CTAs) and the About tab (description,
 * counts, founder link, member role prompt).
 */
export interface ClanProfile {
  id: string
  slug: string
  name: string
  clantag: string
  description: string | null
  avatarUrl: string | null
  coverImageUrl: string | null
  isVerified: boolean
  /** Visibility gate for `Request to join`. Private clans hide
   *  the CTA and refuse applications at the repo boundary. */
  isPrivate: boolean
  memberCount: number
  followerCount: number
  /** ISO timestamp. */
  createdAt: string
  /** `null` when the founder's account was deleted. */
  createdByUserId: string | null
  /** Per-clan join-question schema (for the `Request to join` dialog). */
  joinQuestions: JoinQuestion[]
  /**
   * Caller's role in this clan. `null` when unauthenticated or the
   * caller isn't a member. The website resolves this server-side
   * via `getCallerMembership`; the launcher's tooltip endpoint
   * populates it when the request carries a valid bearer.
   */
  callerRole: ClanRole | null
  topMembers: ClanTooltipMember[]
}

/**
 * Backwards-compat alias. The old launcher code used
 * `ClanTooltip` for the tooltip payload; the new shape extends it
 * with the fields the profile page needs. Re-exported under both
 * names so existing callers (the existing `clan.tsx` page) keep
 * working without a rename pass.
 *
 * @deprecated Use `ClanProfile` for new code — `ClanTooltip` is
 * kept only so the existing tooltip consumers don't break.
 */
export type ClanTooltip = ClanProfile

// ─── Reads ───────────────────────────────────────────────────────────────

/**
 * Read a single clan's public profile by slug.
 *
 * Returns `null` when the API responds 404 or when the api returns
 * `null` — both are intentional "this clan doesn't exist" signals
 * on the server side.
 *
 * The tooltip endpoint is `OptionalAuthGuard`-guarded: when the
 * request carries a valid bearer, the api populates `callerRole`
 * so the caller can gate "Manage clan" / "Leave" without a second
 * round-trip. When the launcher isn't authed (or the bearer is
 * missing) the request still goes through anonymously and the
 * role comes back null.
 *
 * Anonymous reads route through `fetchPublicApi` (Rust transport
 * on Linux, `fetch` elsewhere) — same posture as the launcher's
 * other public endpoints. Authed reads bypass the Rust transport
 * for the same reason `mutateClan` does: the Rust bridge doesn't
 * forward custom headers, so the `Authorization` header would be
 * stripped and `OptionalAuthedUser` would fall through to
 * anonymous. The api's CORS allowlist accepts Tauri's webview
 * origin, so the direct `fetch` is fine.
 */
export async function fetchClanBySlug(
  slug: string,
): Promise<ClanProfile | null> {
  const url = `${CLAN_API_BASE}/${encodeURIComponent(slug)}/tooltip`
  const bearer = getBearerToken()
  if (!bearer) {
    const res = await fetchPublicApi(url)
    if (res.status === 404) return null
    if (!res.ok) {
      throw new Error(`Clan tooltip request failed (HTTP ${res.status})`)
    }
    const body = (await res.json()) as ClanProfile | null
    return body ?? null
  }
  const res = await fetch(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${bearer}`,
    },
  })
  if (res.status === 404) return null
  if (!res.ok) {
    throw new Error(`Clan tooltip request failed (HTTP ${res.status})`)
  }
  const body = (await res.json()) as ClanProfile | null
  return body ?? null
}

/**
 * Fetch a clan's member roster, paginated. Public — no auth.
 *
 * `pageSize` defaults to 100 (api hard cap). Returns the full
 * roster for the requested page along with pagination metadata.
 */
export async function fetchClanMembers(
  slug: string,
  options: { page?: number; pageSize?: number } = {},
): Promise<{
  rows: ClanMember[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}> {
  const params = new URLSearchParams()
  if (options.page) params.set('page', String(options.page))
  if (options.pageSize) params.set('pageSize', String(options.pageSize))
  const qs = params.toString()
  const url = qs
    ? `${CLAN_API_BASE}/${encodeURIComponent(slug)}/members?${qs}`
    : `${CLAN_API_BASE}/${encodeURIComponent(slug)}/members`
  const res = await fetchPublicApi(url)
  if (res.status === 404) {
    throw new Error('Clan not found')
  }
  if (!res.ok) {
    throw new Error(`Clan members request failed (HTTP ${res.status})`)
  }
  return (await res.json()) as {
    rows: ClanMember[]
    total: number
    page: number
    pageSize: number
    totalPages: number
  }
}

/**
 * Fetch a clan's follower list, paginated. Public — no auth.
 */
export async function fetchClanFollowers(
  slug: string,
  options: { page?: number; pageSize?: number } = {},
): Promise<{
  rows: ClanFollower[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}> {
  const params = new URLSearchParams()
  if (options.page) params.set('page', String(options.page))
  if (options.pageSize) params.set('pageSize', String(options.pageSize))
  const qs = params.toString()
  const url = qs
    ? `${CLAN_API_BASE}/${encodeURIComponent(slug)}/followers?${qs}`
    : `${CLAN_API_BASE}/${encodeURIComponent(slug)}/followers`
  const res = await fetchPublicApi(url)
  if (res.status === 404) {
    throw new Error('Clan not found')
  }
  if (!res.ok) {
    throw new Error(`Clan followers request failed (HTTP ${res.status})`)
  }
  return (await res.json()) as {
    rows: ClanFollower[]
    total: number
    page: number
    pageSize: number
    totalPages: number
  }
}

/**
 * Resolve the clan's founder to a public badge. Returns `null`
 * when the clan has no founder (account deleted) so the About tab
 * can render `—` without crashing.
 */
export async function fetchClanFounder(
  slug: string,
): Promise<ClanFounderBadge | null> {
  const res = await fetchPublicApi(
    `${CLAN_API_BASE}/${encodeURIComponent(slug)}/founder`,
  )
  if (res.status === 404) return null
  if (!res.ok) {
    throw new Error(`Clan founder request failed (HTTP ${res.status})`)
  }
  const body = (await res.json()) as { founder: ClanFounderBadge | null }
  return body.founder
}

// ─── Clan directory (list) ───────────────────────────────────────────────

export interface ClanDirectoryEntry {
  id: string
  slug: string
  name: string
  clantag: string
  description: string | null
  avatarUrl: string | null
  coverImageUrl: string | null
  isVerified: boolean
  memberCount: number
  followerCount: number
  topMembers: ClanTooltipMember[]
}

export interface ClanDirectoryPage {
  page: number
  pageSize: number
  totalPages: number
  total: number
  rows: ClanDirectoryEntry[]
}

export interface FetchClanDirectoryOptions {
  page?: number
  pageSize?: number
  q?: string
  sort?: ClanSort
  /**
   * Visibility filter:
   *   - `undefined` (default): all clans (public + private).
   *   - `false`: public clans only.
   *   - `true`: private clans only.
   * Mirrors the website's `visibility` filter so the launcher
   * exposes the same affordance.
   */
  isPrivate?: boolean
  /**
   * When `true`, filters the result to staff-verified clans only.
   */
  verifiedOnly?: boolean
}

/**
 * Read a page of clans from the public directory.
 *
 * The endpoint is `GET /v1/clans` on the api service. It is
 * deliberately public — anyone can browse the clan directory,
 * including signed-out visitors.
 */
export async function fetchClanDirectory(
  options: FetchClanDirectoryOptions = {},
): Promise<ClanDirectoryPage> {
  const params = new URLSearchParams()
  if (options.page) params.set('page', String(options.page))
  if (options.pageSize) params.set('limit', String(options.pageSize))
  if (options.q) params.set('q', options.q)
  if (options.isPrivate === true) params.set('visibility', 'private')
  else if (options.isPrivate === false) params.set('visibility', 'public')
  if (options.verifiedOnly) params.set('verified', 'verified')
  if (options.sort) params.set('sort', options.sort)
  const qs = params.toString()
  const url = qs ? `${CLAN_API_BASE}?${qs}` : CLAN_API_BASE
  const res = await fetchPublicApi(url)
  if (!res.ok) {
    throw new Error(`Clan directory request failed (HTTP ${res.status})`)
  }
  return (await res.json()) as ClanDirectoryPage
}

// ─── Clan mutations (session-gated) ──────────────────────────────────────
//
// All four endpoints mirror the web app's server actions. The
// launcher's webview carries a bearer token in localStorage; we
// forward it via the `Authorization` header so the api's
// `SessionGuard` accepts the call.
//
// The bearer is read fresh on every call (no module-level cache)
// so a sign-in or sign-out reflects immediately without a page
// reload.

/**
 * Pull the persisted bearer out of localStorage. Returns `null`
 * for signed-out visitors — callers should check before issuing
 * a mutation, or pass the slug through to the dialog so it can
 * prompt for sign-in.
 */
function getBearerToken(): string | null {
  const token = readPersistedToken()
  return token?.token ?? null
}

/**
 * Issue an authenticated POST / DELETE against the clans api.
 * Returns the parsed JSON body on 2xx, throws an Error with the
 * server's `message` (Nest's standard error body shape) on
 * non-2xx.
 *
 * Uses a direct `fetch()` (not `fetchPublicApi`) because the
 * renderer's anonymous-fetch Rust bridge doesn't forward custom
 * headers — we need the `Authorization` header to reach the api's
 * `SessionGuard`. Tauri's webview sets the `Origin` header that
 * the api's CORS allowlist accepts.
 *
 * Accepts either `path` (relative to `CLAN_API_BASE`) OR an
 * absolute `urlOverride` (for endpoints whose path doesn't match
 * the `<CLAN_API_BASE><path>` shape, e.g. the cross-clan invite
 * endpoints at `/v1/clans/invites/...`).
 */
async function mutateClan<T>(
  method: 'POST' | 'DELETE',
  path: string,
  body?: unknown,
  urlOverride?: string,
): Promise<T> {
  const bearer = getBearerToken()
  if (!bearer) {
    throw new Error('Sign in to do that.')
  }
  const url = urlOverride ?? `${CLAN_API_BASE}${path}`
  const res = await fetch(url, {
    method,
    headers: {
      accept: 'application/json',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      authorization: `Bearer ${bearer}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let message = `Request failed (HTTP ${res.status})`
    try {
      const errBody = (await res.json()) as { message?: string | string[] }
      if (typeof errBody.message === 'string') {
        message = errBody.message
      } else if (Array.isArray(errBody.message) && errBody.message[0]) {
        message = errBody.message[0]
      }
    } catch {
      // Non-JSON error body — keep the generic HTTP message.
    }
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/**
 * Follow a clan. Idempotent — a duplicate click is a server-side
 * no-op (`onConflictDoNothing` in the repo).
 */
export async function followClan(
  slug: string,
): Promise<{ isFollowing: true }> {
  return mutateClan('POST', `/${encodeURIComponent(slug)}/follow`)
}

/**
 * Unfollow a clan. Idempotent.
 */
export async function unfollowClan(
  slug: string,
): Promise<{ isFollowing: false }> {
  return mutateClan('DELETE', `/${encodeURIComponent(slug)}/follow`)
}

/**
 * Leave a clan. Throws when the caller is the last leader (the
 * server returns the typed `ClanLastLeaderError` message verbatim
 * so the dialog can render it as a toast).
 */
export async function leaveClan(
  slug: string,
): Promise<{ role: null }> {
  return mutateClan('POST', `/${encodeURIComponent(slug)}/leave`)
}

/**
 * Submit a request-to-join application.
 *
 * `answers` is keyed by the clan's current question ids — any
 * keys not present in the current schema are silently dropped by
 * the api (matches the website's `validateApplicationAnswers`
 * posture so a leader who removes a question between dialog open
 * and submit doesn't crash the submission).
 */
export async function requestJoinClan(
  slug: string,
  answers: Record<string, string> = {},
): Promise<{ applicationId: string }> {
  return mutateClan('POST', `/${encodeURIComponent(slug)}/request-join`, {
    answers,
  })
}

// ─── Manage-page API ─────────────────────────────────────────────────────
//
// All endpoints below back the manage page (`#/clan/<slug>/manage`).
// The api service guards them with `CompositeAuthGuard` so the
// launcher can call them with its bearer token; the per-row
// authorization (leader / officer) is enforced at the service
// layer via the `clans.findMembership` check.

/** Single pending application row. Mirrors the api's `ClanApplicationRowDto`. */
export interface ClanApplication {
  id: string
  clanId: string
  applicantUserId: string
  applicantDisplayName: string | null
  applicantAvatarUrl: string | null
  status: 'pending' | 'approved' | 'denied' | 'cancelled' | 'expired'
  answers: Record<string, string>
  createdAt: string
  expiresAt: string
}

/** Pending invite addressed to the caller. */
export interface ClanInviteForMe {
  id: string
  clanId: string
  clanSlug: string
  clanName: string
  clanTag: string
  clanAvatarUrl: string | null
  invitedByDisplayName: string | null
  invitedByAvatarUrl: string | null
  expiresAt: string
  createdAt: string
}

/** Pending invite the caller issued. */
export interface ClanSentInvite {
  id: string
  clanId: string
  clanSlug: string
  clanName: string
  clanTag: string
  invitedUserId: string
  invitedUserDisplayName: string | null
  invitedUserAvatarUrl: string | null
  expiresAt: string
  createdAt: string
}

/** Patch payload for `PATCH /v1/clans/:slug`. All fields optional. */
export interface UpdateClanPatch {
  name?: string
  clantag?: string
  description?: string | null
  avatarObjectKey?: string | null
  coverObjectKey?: string | null
  isPrivate?: boolean
  joinQuestions?: JoinQuestion[]
}

/**
 * Update a clan's editable fields. Mirrors the website's
 * `updateClanAction`. Returns the clan's slug so the caller can
 * navigate to the public profile on success.
 */
export async function updateClan(
  slug: string,
  patch: UpdateClanPatch,
): Promise<{ slug: string }> {
  const url = `${CLAN_API_BASE}/${encodeURIComponent(slug)}`
  return mutateClanPatch(url, patch)
}

/**
 * Change a member's role. Leader-only — the service refuses for
 * officers.
 */
export async function setMemberRole(
  slug: string,
  userId: string,
  role: ClanRole,
): Promise<void> {
  const url = `${CLAN_API_BASE}/${encodeURIComponent(slug)}/members/${encodeURIComponent(userId)}/role`
  return mutateClan('POST', '', { role }, url)
}

/**
 * Remove a member from the clan. Leader or officer only.
 */
export async function removeMember(
  slug: string,
  userId: string,
): Promise<void> {
  const url = `${CLAN_API_BASE}/${encodeURIComponent(slug)}/members/${encodeURIComponent(userId)}`
  return mutateClan('DELETE', '', undefined, url)
}

/**
 * Invite a player to the clan. Leader or officer only.
 */
export async function inviteMember(
  slug: string,
  invitedUserId: string,
): Promise<{ id: string }> {
  const url = `${CLAN_API_BASE}/${encodeURIComponent(slug)}/invites`
  return mutateClan('POST', '', { invitedUserId }, url)
}

/**
 * Approve or deny a pending application.
 */
export async function decideApplication(
  applicationId: string,
  decision: 'approved' | 'denied',
): Promise<{ clanSlug: string }> {
  const url = `${CLAN_API_BASE}/applications/${encodeURIComponent(applicationId)}/decide`
  return mutateClan('POST', '', { decision }, url)
}

/**
 * Accept an invite addressed to the caller.
 */
export async function acceptInvite(
  inviteId: string,
): Promise<{ clanId: string; clanSlug: string }> {
  const url = `${CLAN_API_BASE}/invites/${encodeURIComponent(inviteId)}/accept`
  return mutateClan('POST', '', undefined, url)
}

/**
 * Decline an invite addressed to the caller.
 */
export async function declineInvite(inviteId: string): Promise<void> {
  const url = `${CLAN_API_BASE}/invites/${encodeURIComponent(inviteId)}/decline`
  return mutateClan('POST', '', undefined, url)
}

/**
 * Cancel an invite the caller issued.
 */
export async function cancelInvite(inviteId: string): Promise<void> {
  const url = `${CLAN_API_BASE}/invites/${encodeURIComponent(inviteId)}`
  return mutateClan('DELETE', '', undefined, url)
}

/**
 * List pending applications for a clan. Read-only. Caller must be
 * a leader or officer of the clan.
 */
export async function fetchClanApplications(
  slug: string,
): Promise<ClanApplication[]> {
  const url = `${CLAN_API_BASE}/${encodeURIComponent(slug)}/applications`
  const bearer = getBearerToken()
  if (!bearer) throw new Error('Sign in to do that.')
  const res = await fetch(url, {
    headers: { accept: 'application/json', authorization: `Bearer ${bearer}` },
  })
  if (!res.ok) {
    let message = `Request failed (HTTP ${res.status})`
    try {
      const errBody = (await res.json()) as { message?: string | string[] }
      if (typeof errBody.message === 'string') message = errBody.message
      else if (Array.isArray(errBody.message) && errBody.message[0])
        message = errBody.message[0]
    } catch {
      /* keep generic */
    }
    throw new Error(message)
  }
  return (await res.json()) as ClanApplication[]
}

/**
 * Cheap pending-count for the Requests tab badge. Returns 0 for
 * callers who aren't leaders / officers.
 */
export async function countClanApplications(
  slug: string,
): Promise<number> {
  const url = `${CLAN_API_BASE}/${encodeURIComponent(slug)}/applications/count`
  const bearer = getBearerToken()
  if (!bearer) return 0
  const res = await fetch(url, {
    headers: { accept: 'application/json', authorization: `Bearer ${bearer}` },
  })
  if (!res.ok) return 0
  const body = (await res.json()) as { count: number }
  return body.count
}

/** Read every pending invite addressed to the caller. Cross-clan. */
export async function fetchInvitesForMe(): Promise<ClanInviteForMe[]> {
  const url = `${CLAN_API_BASE}/invites-for-me`
  const bearer = getBearerToken()
  if (!bearer) return []
  const res = await fetch(url, {
    headers: { accept: 'application/json', authorization: `Bearer ${bearer}` },
  })
  if (!res.ok) return []
  return (await res.json()) as ClanInviteForMe[]
}

/** Read every pending invite the caller issued. Cross-clan. */
export async function fetchInvitesISent(): Promise<ClanSentInvite[]> {
  const url = `${CLAN_API_BASE}/invites-i-sent`
  const bearer = getBearerToken()
  if (!bearer) return []
  const res = await fetch(url, {
    headers: { accept: 'application/json', authorization: `Bearer ${bearer}` },
  })
  if (!res.ok) return []
  return (await res.json()) as ClanSentInvite[]
}

/**
 * Issue an authenticated PATCH against the clans api.
 * `mutateClan` doesn't cover PATCH because we only need it for the
 * update-clan endpoint — split out here so the common call sites
 * stay simple.
 */
async function mutateClanPatch<T>(
  url: string,
  body: unknown,
): Promise<T> {
  const bearer = getBearerToken()
  if (!bearer) throw new Error('Sign in to do that.')
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let message = `Request failed (HTTP ${res.status})`
    try {
      const errBody = (await res.json()) as { message?: string | string[] }
      if (typeof errBody.message === 'string') message = errBody.message
      else if (Array.isArray(errBody.message) && errBody.message[0])
        message = errBody.message[0]
    } catch {
      /* keep generic */
    }
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

// ─── R2 presigned upload helper ──────────────────────────────────────────

/**
 * Single R2 presigned-upload payload. Returned by
 * `presignClanAsset` and consumed by `uploadClanAsset` so the
 * launcher's manage page can PUT the cropped image bytes directly
 * to R2 (the api never sees the file body).
 */
export interface PresignedClanUpload {
  url: string
  objectKey: string
  publicUrl: string
  expiresAt: string
  contentDisposition: string | null
}

/**
 * Mint a presigned PUT URL for a clan-avatar or clan-cover
 * upload. The webview then PUTs the file body directly to the
 * returned `url` and hands `objectKey` to `updateClan`.
 *
 * The api's `/v1/clans/r2/presign` endpoint is session-gated; the
 * launcher passes its bearer token in the `Authorization` header.
 */
export async function presignClanAsset(input: {
  kind: 'clan-avatar' | 'clan-cover'
  clanId: string
  filename: string
  contentType: string
  contentLength: number
}): Promise<PresignedClanUpload> {
  const url = `${CLAN_API_BASE}/r2/presign`
  const bearer = getBearerToken()
  if (!bearer) throw new Error('Sign in to do that.')
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    let message = `Presign request failed (HTTP ${res.status})`
    try {
      const errBody = (await res.json()) as { message?: string | string[] }
      if (typeof errBody.message === 'string') message = errBody.message
      else if (Array.isArray(errBody.message) && errBody.message[0])
        message = errBody.message[0]
    } catch {
      /* keep generic */
    }
    throw new Error(message)
  }
  return (await res.json()) as PresignedClanUpload
}

/**
 * PUT the file bytes to a presigned R2 URL. The webview does the
 * upload directly so the api never sees the file body. Returns
 * the `objectKey` the caller hands to `updateClan` to commit the
 * change.
 */
export async function uploadClanAsset(
  presigned: PresignedClanUpload,
  blob: Blob,
): Promise<string> {
  const headers: Record<string, string> = {
    'content-type': blob.type || 'application/octet-stream',
  }
  if (presigned.contentDisposition) {
    headers['content-disposition'] = presigned.contentDisposition
  }
  const res = await fetch(presigned.url, {
    method: 'PUT',
    headers,
    body: blob,
  })
  if (!res.ok) {
    throw new Error(`Upload failed (HTTP ${res.status})`)
  }
  return presigned.objectKey
}
