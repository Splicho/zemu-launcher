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
import { fetchPublicApi } from '@/lib/public-api'

export type LeaderboardTier =
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'platinum'
  | 'diamond'
  | 'master'

export const TIER_VALUES: readonly LeaderboardTier[] = [
  'bronze',
  'silver',
  'gold',
  'platinum',
  'diamond',
  'master',
]

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
  /** ISO 3166-1 alpha-2 country code, or null when unset. */
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

export const TIER_COLORS: Record<LeaderboardTier, string> = {
  bronze: '#CD7F32',
  silver: '#C0C0C0',
  gold: '#FFD700',
  platinum: '#E5E4E2',
  diamond: '#B9F2FF',
  master: '#FF6B6B',
}

export const MOCK_LEADERBOARD: LeaderboardEntry[] = []

export interface FetchTopLeaderboardOptions {
  limit?: number
  tier?: LeaderboardTier | 'all'
}

export async function fetchTopLeaderboard(
  options: FetchTopLeaderboardOptions = {}
): Promise<LeaderboardEntry[]> {
  const { limit = 5, tier = 'all' } = options

  // This endpoint returns the full standings and ignores tier/limit query
  // parameters. Filter before taking the top rows, including players outside
  // the overall top five, and preserve the server's order and positions.
  const response = await fetchPublicApi(`${STATS_API_BASE}/leaderboards`)
  if (!response.ok) {
    throw new Error(`Leaderboard request failed (HTTP ${response.status})`)
  }
  const data = await response.json()
  const entries = (data.entries ?? []) as Array<
    Omit<LeaderboardEntry, 'country'> & { country?: string | null }
  >
  const matchingEntries = (tier === 'all' ? entries : entries.filter(entry => entry.tier === tier))
    // Normalise `country: undefined` (old api / player missing a user row) to `null`.
    .map(e => ({ ...e, country: e.country ?? null }))

  // Sort by Total Score (top10TotalScore), highest first.
  matchingEntries.sort((a, b) => b.top10TotalScore - a.top10TotalScore)

  // Re-assign position numbers after sorting so #1 reflects the highest score.
  matchingEntries.forEach((entry, index) => {
    entry.position = index + 1
  })

  return matchingEntries.slice(0, limit)
}

// ─── Full leaderboard (page) ───────────────────────────────────────────────

/** Fetch all standings for the leaderboard page. Server pre-sorts by top10TotalScore. */
export async function fetchLeaderboardEntries(): Promise<LeaderboardEntry[]> {
  const response = await fetchPublicApi(`${STATS_API_BASE}/leaderboards`)
  if (!response.ok) throw new Error(`Leaderboard request failed (HTTP ${response.status})`)
  const data = await response.json()
  const entries = (data.entries ?? []) as Array<
    Omit<LeaderboardEntry, 'country'> & { country?: string | null }
  >
  return entries.map(e => ({ ...e, country: e.country ?? null }))
}

/** Fetch a single player's top-10 match history. */
export async function fetchPlayerTopMatches(name: string): Promise<MatchData[]> {
  const response = await fetchPublicApi(
    `${STATS_API_BASE}/player/${encodeURIComponent(name)}`
  )
  if (!response.ok) throw new Error(`Player matches failed (HTTP ${response.status})`)
  const data = await response.json()
  return (data.topMatches ?? []) as MatchData[]
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
  const response = await fetchPublicApi(`${STATS_API_BASE}/clans/clantags?names=${qs}`)
  if (!response.ok) throw new Error(`Clantags failed (HTTP ${response.status})`)
  const list = (await response.json()) as ClanTagEntry[]
  return new Map(list.map(entry => [entry.key, entry]))
}
