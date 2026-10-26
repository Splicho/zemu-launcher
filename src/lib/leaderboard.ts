/**
 * Leaderboard types mirroring the zemu-website API.
 *
 * The website also exposes a `country` field on `LeaderboardEntry` that
 * is enriched server-side from the `user` table. The launcher's API
 * service (`apps/api/src/leaderboard/leaderboard.service.ts`) also
 * resolves this enrichment, so `fetchLeaderboardEntries` types the
 * field as optional here and normalises `undefined` to `null`.
 */

import { LAUNCHER_CONFIG } from '@/config/launcher'
import { httpFetch } from '@/lib/http-fetch'

export type LeaderboardTier =
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'platinum'
  | 'diamond'
  | 'royalty'

/**
 * The upstream game server still labels the top rank "Master", but the
 * api normalises both `master` and `royalty` onto the single `royalty`
 * tier (see `normalizeTier` in the website's `leaderboard.service.ts`).
 * Entries are typed as the api's output — `royalty` only — so this
 * list is the exact set of values a row can carry.
 */
export const TIER_VALUES: readonly LeaderboardTier[] = [
  'bronze',
  'silver',
  'gold',
  'platinum',
  'diamond',
  'royalty',
]

/**
 * Accepts a tier straight off the wire and narrows it to our union,
 * falling back to `bronze` for anything unrecognised.
 *
 * The api normalises the tier already, but it does so from the
 * upstream `rankName` — an unlabelled or newly-added rank would hit
 * its `default` branch and come back as `"bronze"`, so a bad value
 * can still reach us. This guard exists so a single malformed row
 * degrades to Bronze instead of blowing up the whole table with a
 * `Cannot read properties of undefined` crash in the tier column.
 */
export function normalizeTier(value: unknown): LeaderboardTier {
  return TIER_VALUES.includes(value as LeaderboardTier)
    ? (value as LeaderboardTier)
    : 'bronze'
}

export interface MatchData {
  placement?: number
  kills?: number
  score?: number
  date?: number
}

export interface LeaderboardEntry {
  position: number
  name: string
  tier: LeaderboardTier
  /**ISO 3166-1 alpha-2 country code, or null when unset. */
  country: string | null
  top10TotalScore: number
  topMatchScore: number
  topMatchKills: number
  totalWins: number
  winRate: number
  top10FinishRate: number
  killsPerMatch: number
  topMatches?: MatchData[]
}

export interface LeaderboardSelection {
  region: string
  teamMode: string
}

/**
 * The season upstream is global — it ignores region and mode. "All
 * modes" therefore always maps to the season board for either region;
 * the region only scopes the mode-specific recent-match boards.
 *
 * The page opens on EU / All modes.
 */
export const DEFAULT_LEADERBOARD_SELECTION: LeaderboardSelection = {
  region: 'EU',
  teamMode: 'all',
}

const REGION_PARAM: Record<string, string> = { EU: 'eu', NA: 'na' }
const MODE_PARAM: Record<string, string> = {
  Solo: 'solos',
  Duo: 'duos',
  Fives: 'fives',
}

export function leaderboardPath(selection: LeaderboardSelection): string {
  const region = REGION_PARAM[selection.region]
  const mode = MODE_PARAM[selection.teamMode]

  // The season board has no region or mode split, so every "All modes"
  // selection shows it. This is the default view.
  if (!mode) {
    return '/leaderboards'
  }

  const params = new URLSearchParams()
  if (region) params.set('region', region)
  params.set('mode', mode)
  return `/leaderboards/matches?${params.toString()}`
}

// ─── URL resolution ───────────────────────────────────────────────────────
//
// All four API consumers (friends, news, streams, leaderboard) share
// `VITE_API_URL`, which points at the root of the api server.

function getStatsApiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_URL as string | undefined
  if (import.meta.env.DEV && fromEnv) return `${fromEnv}/v1/stats`
  return LAUNCHER_CONFIG.statsApiBaseUrl
}

const STATS_API_BASE = getStatsApiBaseUrl()

// Clantags live under `/v1/clans` on the api, NOT under `/v1/stats` —
// the clans controller owns the `GET /clantags` batch endpoint used by
// the leaderboard table. The dev override (`VITE_API_URL`) is shared
// with the rest of the api surface, so we mirror the resolution rule
// from `src/lib/clan.ts`.
function getClantagsBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_URL as string | undefined
  if (import.meta.env.DEV && fromEnv) return `${fromEnv}/v1/clans`
  return LAUNCHER_CONFIG.friendsApiBaseUrl.replace(/\/$/, '') + '/v1/clans'
}

const CLANTAGS_BASE = getClantagsBaseUrl()

export const TIER_COLORS: Record<LeaderboardTier, string> = {
  bronze: '#CD7F32',
  silver: '#C0C0C0',
  gold: '#FFD700',
  platinum: '#E5E4E2',
  diamond: '#B9F2FF',
  royalty: '#FF6B6B',
}

export const MOCK_LEADERBOARD: LeaderboardEntry[] = []

export interface FetchTopLeaderboardOptions {
  limit?: number
  tier?: LeaderboardTier | 'all'
}

/**
 * Normalise a raw wire row into a `LeaderboardEntry`.
 *
 * The api sends `country: undefined` when a player has no `user` row,
 * which we flatten to `null`. The tier goes through `normalizeTier` so
 * an unrecognised rank degrades to Bronze here, at the boundary, rather
 * than crashing every consumer that indexes a per-tier record.
 */
function toEntry(
  raw: Omit<LeaderboardEntry, 'country' | 'tier'> & {
    country?: string | null
    tier?: unknown
  },
): LeaderboardEntry {
  return { ...raw, tier: normalizeTier(raw.tier), country: raw.country ?? null }
}

export async function fetchTopLeaderboard(
  options: FetchTopLeaderboardOptions = {}
): Promise<LeaderboardEntry[]> {
  const { limit = 5, tier = 'all' } = options

  // This endpoint returns the full standings and ignores tier/limit query
  // parameters. Filter before taking the top rows, including players outside
  // the overall top five, and preserve the server's order and positions.
  const response = await httpFetch(`${STATS_API_BASE}/leaderboards`, { headers: { Accept: 'application/json' } })
  if (!response.ok) {
    throw new Error(`Leaderboard request failed (HTTP ${response.status})`)
  }
  const data = await response.json()
  const entries = ((data.entries ?? []) as Array<Parameters<typeof toEntry>[0]>).map(toEntry)
  const matchingEntries = tier === 'all' ? entries : entries.filter(entry => entry.tier === tier)

  // Sort by Total Score (top10TotalScore), highest first.
  matchingEntries.sort((a, b) => b.top10TotalScore - a.top10TotalScore)

  // Re-assign position numbers after sorting so #1 reflects the highest score.
  matchingEntries.forEach((entry, index) => {
    entry.position = index + 1
  })

  return matchingEntries.slice(0, limit)
}

// ─── Full leaderboard (page) ───────────────────────────────────────────────

/** Fetch all standings for the leaderboard page. */
export async function fetchLeaderboardEntries(
  selection: LeaderboardSelection = DEFAULT_LEADERBOARD_SELECTION,
): Promise<LeaderboardEntry[]> {
  const response = await httpFetch(`${STATS_API_BASE}${leaderboardPath(selection)}`, {
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`Leaderboard request failed (HTTP ${response.status})`)
  const data = await response.json()
  const entries = ((data.entries ?? []) as Array<Parameters<typeof toEntry>[0]>).map(toEntry)
  // The upstream game server assigns `position` by its own array
  // order, which does NOT match our launcher's ranking metric
  // (`top10TotalScore`, computed server-side by summing each player's
  // top 10 matches). If we trusted the upstream positions, the `#`
  // column would disagree with the default "sort by top10TotalScore"
  // the table applies on load — #3 could sit above #2 in the list.
  // So sort by top10TotalScore and reassign positions 1-N so the
  // launcher's "rank" is consistent with the column the table is
  // sorted by default.
  const ranked = [...entries].sort((a, b) => b.top10TotalScore - a.top10TotalScore)
  ranked.forEach((entry, index) => {
    entry.position = index + 1
  })
  return ranked
}

// ─── Clantag lookups ──────────────────────────────────────────────────────

export interface ClanTagEntry {
  /** Lowercased display name — used as the lookup key. */
  key: string
  clanSlug: string
  clanName: string
  clantag: string
}

/**
 * Resolve a batch of display names to their clantag affiliation.
 * Returns a `Map<nameLower, ClanTagEntry>`. Players without a clan
 * are simply absent from the map.
 */
export async function fetchClantags(
  names: readonly string[]
): Promise<Map<string, ClanTagEntry>> {
  if (names.length === 0) return new Map()
  const qs = encodeURIComponent(names.join(','))
  const response = await httpFetch(`${CLANTAGS_BASE}/clantags?names=${qs}`, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`Clantags failed (HTTP ${response.status})`)
  const list = (await response.json()) as ClanTagEntry[]
  return new Map(list.map(entry => [entry.key, entry]))
}