/**
 * News reads for the public site.
 *
 * Two endpoints live behind `api.zemu.uk/v1/news`:
 *   - GET /v1/news              → list (NewsListItem[])
 *   - GET /v1/news/:slug         → single post with bodyHtml (NewsFull)
 *
 * Both are deliberately public (no auth). The TypeScript shapes below
 * mirror the API DTOs from the zemu-website apps/api service. If the
 * API gains or renames a field, update the type here — the runtime is
 * the source of truth, the type just keeps the renderer honest.
 *
 * The launcher never sees `bodyHtml` on the list response (the API
 * intentionally omits it from list items to keep payloads small). The
 * detail view fetches a separate single-item response when the user
 * opens a card.
 */

import { LAUNCHER_CONFIG } from '@/config/launcher'
import { fetchPublicApi } from '@/lib/public-api'

export interface NewsListItem {
  slug: string
  category: string
  categorySlug: string
  coverImageUrl: string | null
  coverImageAlt: string
  publishedAt: string
  title: string
  excerpt: string
}

export interface NewsFull extends NewsListItem {
  bodyHtml: string
}

/**
 * Resolve the news API base URL.
 *
 * All four API consumers (friends, news, streams, leaderboard) share
 * `VITE_API_URL`, which points at the root of the api server.
 * This function appends the news-specific route.
 *
 * Precedence (first wins):
 *   1. `VITE_API_URL` set in `.env.local` — Vite exposes this only
 *      at dev-time, so production bundles ignore it entirely.
 *   2. `LAUNCHER_CONFIG.newsApiBaseUrl` — the bundled default,
 *      `https://api.zemu.uk/v1/news` in published builds.
 *
 * These endpoints use the anonymous public-API transport: native HTTP
 * on Linux, browser fetch on other platforms. Auth API configuration
 * and the launcher session are independent of the news feed.
 */
function getNewsApiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_URL as string | undefined
  if (import.meta.env.DEV && fromEnv) return `${fromEnv}/v1/news`
  return LAUNCHER_CONFIG.newsApiBaseUrl
}

const NEWS_API_BASE = getNewsApiBaseUrl()

/**
 * Fetch the latest published news posts. Throws on any non-2xx or
 * network failure — callers are expected to handle the error UI
 * (loading vs. error vs. empty) themselves.
 *
 * The list endpoint can return an empty array (no posts published
 * yet), which is a successful response — callers should treat `[]`
 * as a real "no news" state, not an error.
 */
export async function fetchNewsList(): Promise<NewsListItem[]> {
  const response = await fetchPublicApi(`${NEWS_API_BASE}`)
  if (!response.ok) {
    throw new Error(`News list request failed (HTTP ${response.status})`)
  }
  return (await response.json()) as NewsListItem[]
}

/**
 * Fetch a single post by slug. Returns `null` when the API responds
 * with 404 (the slug is either unknown or unpublished — the public
 * surface intentionally conflates the two). Throws on any other
 * non-2xx or network failure.
 */
export async function fetchNewsBySlug(slug: string): Promise<NewsFull | null> {
  const response = await fetchPublicApi(`${NEWS_API_BASE}/${encodeURIComponent(slug)}`)
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`News item request failed (HTTP ${response.status})`)
  }
  return (await response.json()) as NewsFull
}

/**
 * Render the API's `publishedAt` (ISO 8601) as a short human-readable
 * date string for the card meta line. The API doesn't ship a locale,
 * so we use the user's runtime locale. Returns an empty string on
 * unparseable input rather than throwing — a missing date shouldn't
 * blow up the card.
 */
export function formatNewsDate(iso: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
