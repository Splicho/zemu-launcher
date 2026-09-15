/**
 * Leaderboard types mirroring the zemu-website API.
 */

import { LAUNCHER_CONFIG } from '@/config/launcher'
import { fetchPublicApi } from '@/lib/public-api'

export type LeaderboardTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'master'

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
  const entries = (data.entries ?? []) as LeaderboardEntry[]
  const matchingEntries = tier === 'all' ? entries : entries.filter(entry => entry.tier === tier)
  return matchingEntries.slice(0, limit)
}
