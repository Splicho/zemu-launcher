/**
 * Leaderboard types mirroring the zemu-website API.
 */

import { LAUNCHER_CONFIG } from '@/config/launcher'

export type LeaderboardTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'master'

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

export const MOCK_LEADERBOARD: LeaderboardEntry[] = [
  {
    position: 1,
    name: 'xXVoidSlayerXv',
    tier: 'master',
    top10TotalScore: 284750,
    topMatchScore: 28500,
    topMatchKills: 23,
    totalWins: 1247,
    winRate: 0.38,
    top10FinishRate: 0.82,
    killsPerMatch: 8.4,
  },
  {
    position: 2,
    name: 'NightHawk_99',
    tier: 'master',
    top10TotalScore: 276300,
    topMatchScore: 27200,
    topMatchKills: 21,
    totalWins: 1102,
    winRate: 0.34,
    top10FinishRate: 0.79,
    killsPerMatch: 7.8,
  },
  {
    position: 3,
    name: 'K1LL3R_QUEEN',
    tier: 'diamond',
    top10TotalScore: 261850,
    topMatchScore: 26800,
    topMatchKills: 19,
    totalWins: 987,
    winRate: 0.31,
    top10FinishRate: 0.75,
    killsPerMatch: 7.2,
  },
  {
    position: 4,
    name: 'ShadowStriker',
    tier: 'diamond',
    top10TotalScore: 248600,
    topMatchScore: 25100,
    topMatchKills: 18,
    totalWins: 876,
    winRate: 0.29,
    top10FinishRate: 0.71,
    killsPerMatch: 6.9,
  },
  {
    position: 5,
    name: 'DeathDealer_X',
    tier: 'platinum',
    top10TotalScore: 234200,
    topMatchScore: 24300,
    topMatchKills: 17,
    totalWins: 754,
    winRate: 0.26,
    top10FinishRate: 0.68,
    killsPerMatch: 6.4,
  },
]

export async function fetchTopLeaderboard(limit = 5): Promise<LeaderboardEntry[]> {
  if (import.meta.env.DEV) {
    return MOCK_LEADERBOARD.slice(0, limit)
  }

  const response = await fetch(`${STATS_API_BASE}/leaderboards?limit=${limit}`)
  if (!response.ok) {
    throw new Error(`Leaderboard request failed (HTTP ${response.status})`)
  }
  const data = await response.json()
  return (data.entries ?? []) as LeaderboardEntry[]
}
