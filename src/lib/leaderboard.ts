/**
 * Leaderboard types mirroring the zemu-website API.
 */

import { LAUNCHER_CONFIG } from '@/config/launcher'

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

function getStatsApiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_STATS_API_BASE_URL as string | undefined
  if (import.meta.env.DEV && fromEnv) return fromEnv
  return `${LAUNCHER_CONFIG.statsApiBaseUrl}`
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

  const params = new URLSearchParams({ limit: String(limit) })
  if (tier !== 'all') params.set('tier', tier)
  const response = await fetch(`${STATS_API_BASE}/leaderboards?${params}`)
  if (!response.ok) {
    throw new Error(`Leaderboard request failed (HTTP ${response.status})`)
  }
  const data = await response.json()
  return ((data.entries ?? []) as LeaderboardEntry[]).slice(0, limit)
}
