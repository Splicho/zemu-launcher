/**
 * Public match-stats reads for the player profile.
 *
 * Same endpoints the website's `apps/web/lib/player-stats.ts` uses; the api
 * proxies Ghost's public match API and caches per player, so the launcher
 * never talks to the game server directly.
 *
 * Every helper degrades instead of throwing: stats are decorative, and the
 * profile itself must keep rendering when Ghost is down or the player has
 * never played.
 */

import { LAUNCHER_CONFIG } from '@/config/launcher'
import { httpFetch } from '@/lib/http-fetch'
import type { LeaderboardTier } from '@/lib/leaderboard'

function getStatsApiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_URL as string | undefined
  if (import.meta.env.DEV && fromEnv) return `${fromEnv}/v1/stats`
  return LAUNCHER_CONFIG.statsApiBaseUrl
}

const STATS_API_BASE = getStatsApiBaseUrl()

/** The player's current position on the global season board. */
export interface PlayerRank {
  position: number
  tier: LeaderboardTier
  totalPlayers: number
  top10TotalScore: number
  wins: number
}

/** One aggregate bucket — `total`, or a per-mode entry. */
export interface PlayerMatchTotals {
  matches: number
  wins: number
  /** Wins / matches, as a fraction (0–1). */
  winRate: number
  kills: number
  killsPerMatch: number
  top10: number
  bestPlacement: number | null
  averagePlacement: number | null
  /** Unix milliseconds of the most recent match, or `null` when none. */
  lastPlayedAt: number | null
}

export interface PlayerMatchStats {
  name: string
  total: PlayerMatchTotals
  /** Per-mode buckets keyed by the game's lowercase mode (`solos`, `duos`, …). */
  byMode: Record<string, PlayerMatchTotals>
}

/** One row of the player's recent-match history. */
export interface PlayerRecentMatch {
  id: string
  region: string
  mode: string
  /** Unix milliseconds. */
  startedAt: number
  endedAt: number
  playerCount: number
  winner: string | null
  winnerCountry: string | null
  winnerAvatarUrl: string | null
  winnerRoyalty: boolean
  winnerClan: { slug: string; name: string; tag: string } | null
  placement: number | null
  kills: number
  score: number
}

export interface PlayerRecentMatches {
  matches: PlayerRecentMatch[]
  total: number
}

/** One player in a match's full lobby. */
export interface PlayerMatchDetailPlayer {
  name: string
  characterId: string | null
  placement: number | null
  kills: number
  score: number
  teamId: string | null
  teammates: string[]
  /** ISO 3166-1 alpha-2 code, or `null` when the player never set one. */
  country: string | null
  /** Public avatar URL, or `null` when the player has no avatar. */
  avatarUrl: string | null
  /** `true` when the player is the #1 ranked Royalty player. */
  royalty: boolean
  /** Equipped clan, or `null` when the player hasn't opted into one. */
  clan: { slug: string; name: string; tag: string } | null
}

/**
 * Full detail for a single match — every player in the lobby plus the
 * result. Fetched on demand when a match-history row is expanded.
 */
export interface PlayerMatchDetail {
  id: string
  region: string
  mode: string
  category: string
  instance: number | null
  /** Unix milliseconds. */
  startedAt: number
  endedAt: number
  playerCount: number
  hosted: boolean
  winner: string | null
  winners: string[]
  players: PlayerMatchDetailPlayer[]
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const response = await httpFetch(`${STATS_API_BASE}${path}`, {
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return null
    const body = (await response.json()) as T | null
    return body && typeof body === 'object' ? body : null
  } catch {
    return null
  }
}

/**
 * Totals for every match the game server has recorded for this player.
 * `null` means "no stats" — either the player is unknown to Ghost or the
 * request failed; the UI renders em dashes for both.
 */
export function fetchPlayerMatchStats(displayName: string): Promise<PlayerMatchStats | null> {
  return getJson<PlayerMatchStats>(`/players/${encodeURIComponent(displayName)}/stats`)
}

/** Newest-first match list. `limit` is clamped by the api. */
export async function fetchPlayerRecentMatches(
  displayName: string,
  limit = 1000,
): Promise<PlayerRecentMatches> {
  const body = await getJson<PlayerRecentMatches>(
    `/players/${encodeURIComponent(displayName)}/matches?limit=${limit}`,
  )
  return {
    matches: Array.isArray(body?.matches) ? body.matches : [],
    total: typeof body?.total === 'number' ? body.total : 0,
  }
}

/** Season-board position derived from the cached leaderboard. */
export function fetchPlayerRank(displayName: string): Promise<PlayerRank | null> {
  return getJson<PlayerRank>(`/players/${encodeURIComponent(displayName)}/rank`)
}

/** Full lobby for one match, or `null` when the id is unknown. */
export function fetchMatchDetail(matchId: string): Promise<PlayerMatchDetail | null> {
  return getJson<PlayerMatchDetail>(`/matches/${encodeURIComponent(matchId)}`)
}
