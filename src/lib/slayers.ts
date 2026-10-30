/**
 * "Slayers of the Week" — the five players with the most kills across the
 * last seven days.
 *
 * Backed by `GET /v1/stats/slayers` in the zemu-website api. The api
 * aggregates the public match feed itself (the upstream has no weekly
 * endpoint), so the launcher just renders the rows.
 *
 * Clan tags are resolved here as well as on the server: the public
 * `GET /v1/clans/clantags?names=…` endpoint already exists on every
 * deployed api build, so tags show up even when the stats service is an
 * older revision that doesn't ship the `clanTag` field yet. When the api
 * does return tags, no extra request is made.
 */

import { LAUNCHER_CONFIG } from '@/config/launcher'
import { httpFetch } from '@/lib/http-fetch'

export interface SlayerEntry {
  name: string
  /** Kills summed over every finished match in the window. */
  kills: number
  /** Matches the player appears in inside the window. */
  matches: number
  /** ISO 3166-1 alpha-2 code, or null when the player hasn't set one. */
  country: string | null
  /** Equipped clan tag (e.g. `ZMU`), or null when none is equipped. */
  clanTag: string | null
  /** Slug of the equipped clan, used to link the badge. */
  clanSlug: string | null
}

export interface SlayersResponse {
  entries: SlayerEntry[]
  /** Inclusive start of the window (ISO). */
  from: string
  /** End of the window / generation time (ISO). */
  to: string
  /** Next weekly reset (ISO) — Monday 00:00 UTC. */
  resetsAt: string
  fetchedAt: string
  source: 'live' | 'cache' | 'unavailable'
}

/** One row of the public `/v1/clans/clantags` response. */
interface ClanTagDto {
  /** Lowercased display name. */
  key: string
  clantag: string
  /** Clan slug, so the badge can link to `#/clan/<slug>`. */
  clanSlug: string
}

function getStatsApiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_URL as string | undefined
  if (import.meta.env.DEV && fromEnv) return `${fromEnv}/v1/stats`
  return LAUNCHER_CONFIG.statsApiBaseUrl
}

function getClansApiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_URL as string | undefined
  if (import.meta.env.DEV && fromEnv) return `${fromEnv}/v1/clans`
  return LAUNCHER_CONFIG.clansApiBaseUrl
}

const STATS_API_BASE = getStatsApiBaseUrl()
const CLANS_API_BASE = getClansApiBaseUrl()

/**
 * Fill in any missing clan tag by asking the public clantag endpoint the
 * leaderboard already uses. Best-effort: a failure leaves `clanTag: null`
 * rather than failing the whole table.
 */
async function attachClanTags(entries: SlayerEntry[]): Promise<SlayerEntry[]> {
  const missing = entries.filter((entry) => !entry.clanTag)
  if (missing.length === 0) return entries

  const names = missing.map((entry) => entry.name).join(',')
  const response = await httpFetch(
    `${CLANS_API_BASE}/clantags?names=${encodeURIComponent(names)}`,
    { headers: { Accept: 'application/json' } },
  )
  if (!response.ok) return entries

  const tags = (await response.json()) as ClanTagDto[]
  const byName = new Map(tags.map((tag) => [tag.key, tag]))

  return entries.map((entry) => {
    if (entry.clanTag) return entry
    const found = byName.get(entry.name.toLowerCase())
    return found ? { ...entry, clanTag: found.clantag, clanSlug: found.clanSlug } : entry
  })
}

export async function fetchSlayersOfTheWeek(): Promise<SlayersResponse> {
  const response = await httpFetch(`${STATS_API_BASE}/slayers`, {
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`Slayers request failed (HTTP ${response.status})`)
  }

  const payload = (await response.json()) as SlayersResponse
  if (!payload.entries?.length) return payload

  try {
    return { ...payload, entries: await attachClanTags(payload.entries) }
  } catch {
    // Tags are decoration; never let this hide the board.
    return payload
  }
}
