/**
 * Player-profile reads for the public site.
 *
 * One endpoint lives behind `api.zemu.uk/v1/players`:
 *   - GET /v1/players/:displayName → PlayerProfile
 *
 * The endpoint is deliberately public (no auth). The TypeScript
 * shapes below mirror the API DTO from the zemu-website
 * `apps/api/src/players/players.service.ts`. If the API gains or
 * renames a field, update the type here — the runtime is the source
 * of truth, the type just keeps the renderer honest.
 *
 * Uses `httpFetch` (Rust transport on desktop, browser
 * fetch in previews) — same path the news, leaderboard, and friends
 * libs use. CORS is handled by the same shared middleware.
 */

import { LAUNCHER_CONFIG } from '@/config/launcher'
import { httpFetch } from '@/lib/http-fetch'

function getPlayerApiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_URL as string | undefined
  if (import.meta.env.DEV && fromEnv) return `${fromEnv}/v1/players`
  return LAUNCHER_CONFIG.friendsApiBaseUrl.replace(/\/$/, '') + '/v1/players'
}

const PLAYER_API_BASE = getPlayerApiBaseUrl()

export interface PlayerSetup {
  monitor: string | null
  cpu: string | null
  gpu: string | null
  ram: string | null
  keyboard: string | null
  mouse: string | null
  mousepad: string | null
  headset: string | null
  dpi: number | null
  sensitivity: number | null
  /** In-game render resolution (e.g. "1920x1080"). */
  ingameResolution: string | null
}

export interface PlayerClanAffiliation {
  slug: string
  name: string
  clantag: string
}

export interface PlayerProfile {
  displayName: string
  avatarUrl: string | null
  coverImageUrl: string | null
  /** ISO 3166-1 alpha-2 country code, or null when unset. */
  country: string | null
  /** ISO-8601 timestamp of when the account was created. */
  joinedAt: string
  discordId: string | null
  steamId: string | null
  setup: PlayerSetup | null
  useroptionsIniUrl: string | null
  clan: PlayerClanAffiliation | null
}

/**
 * Read a single player's public profile by display name.
 *
 * Returns `null` when the API responds 404 — unknown display names
 * and banned display names both intentionally look the same to the
 * public (the api's `NotFoundException` route drops both to 404).
 *
 * Throws on any other non-2xx so callers can distinguish a real
 * outage from a missing player.
 */
export async function fetchPlayerByDisplayName(
  displayName: string,
): Promise<PlayerProfile | null> {
  const res = await httpFetch(
    `${PLAYER_API_BASE}/${encodeURIComponent(displayName)}`,
    { headers: { Accept: 'application/json' } },
  )
  if (res.status === 404) return null
  if (!res.ok) {
    throw new Error(
      `Player profile request failed (HTTP ${res.status})`,
    )
  }
  return (await res.json()) as PlayerProfile
}
