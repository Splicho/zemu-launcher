import { DEFAULT_LEADERBOARD_SELECTION } from '@/lib/leaderboard'

export type LeaderboardFilters = {
  search: string
  tier: string
  /** ISO 3166-1 alpha-2 code, or "" for "All countries". */
  country: string
  region: string
  teamMode: string
  pageSize: number
}

export const DEFAULT_FILTERS: LeaderboardFilters = {
  search: '',
  tier: 'all',
  country: '',
  region: DEFAULT_LEADERBOARD_SELECTION.region,
  teamMode: DEFAULT_LEADERBOARD_SELECTION.teamMode,
  pageSize: 50,
}
