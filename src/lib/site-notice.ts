/**
 * Site notice banner reads for the desktop launcher.
 *
 * Mirrors the public web app's `lib/site-notice.ts`, but for the
 * `launcher` surface. Two endpoints matter here:
 *
 *   - GET https://api.zemu.uk/v1/site-notice?surface=launcher
 *
 * The endpoint is deliberately unauthenticated (see the api's
 * `SiteNoticeController`) — the banner is public copy and the launcher
 * has to read it before/independently of a session. It returns `200`
 * with a `null` body when nothing is live, so callers never have to
 * special-case a 404 to mean "no banner today".
 *
 * Why `httpFetch` and not `fetch`: on desktop every outbound call goes
 * through Rust + `reqwest` so the WebView's CORS never applies. The
 * banner is read through the same anonymous transport as the news feed
 * — no bearer token, no launcher session required.
 *
 * Why errors are swallowed: unlike news — where a failed fetch means
 * the page has nothing to render — a failed notice fetch means the
 * launcher should simply render without a bar. A database blip must
 * not take down the shell. The hook's `retry` posture handles the
 * transient case; everything else degrades to "no banner".
 *
 * The `surface` is passed explicitly even though the api defaults to
 * `web`: the api rejects an unrecognised value with a 400, and a typo
 * swallowed into "no banner" is a failure mode worth making
 * impossible at the call site.
 */

import { LAUNCHER_CONFIG } from '@/config/launcher'
import { httpFetch } from '@/lib/http-fetch'

export interface SiteNotice {
  id: string
  variant: 'success' | 'alert' | 'warning' | 'info'
  text: string
  linkUrl: string | null
  /** Already resolved to "Read more" server-side when the admin left the label blank. */
  linkLabel: string | null
  isDismissible: boolean
  /**
   * Echoed back by the api so a caller that asked for `launcher` can
   * tell a real launcher notice apart from a default-`web` response
   * it should not have received. We assert on it — see
   * `fetchSiteNotice`.
   */
  surface: 'web' | 'launcher'
}

const SITE_NOTICE_PATH = '/v1/site-notice'

/**
 * Resolve the site-notice API root.
 *
 * Shares `VITE_API_URL` with the other four public API consumers
 * (friends, news, streams, leaderboard). Vite only exposes that in
 * dev, so published builds ignore it entirely and use the bundled
 * `friendsApiBaseUrl` (`https://api.zemu.uk`).
 */
function getSiteNoticeApiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_URL as string | undefined
  if (import.meta.env.DEV && fromEnv) return fromEnv.replace(/\/$/, '')
  return LAUNCHER_CONFIG.friendsApiBaseUrl.replace(/\/$/, '')
}

const SITE_NOTICE_API_BASE = getSiteNoticeApiBaseUrl()

/**
 * Fetch the live notice for the `launcher` surface, or `null` when
 * nothing is active.
 *
 * Unlike `lib/news.ts`, this never throws: a non-OK response (api
 * down, bad deploy) is logged and treated as "no banner". A dismissal
 * UI that can break the app shell is not worth the strictness — the
 * caller has no error state to render anyway.
 *
 * The payload is validated rather than blindly cast. `text` is the
 * only field the renderer trusts unconditionally; a payload that
 * doesn't have one is treated as "no banner" instead of rendering an
 * empty bar. `surface` is checked too, so a misconfigured proxy that
 * rewrote the query string can't make us show the website's banner in
 * the desktop app.
 */
export async function fetchSiteNotice(): Promise<SiteNotice | null> {
  const url = `${SITE_NOTICE_API_BASE}${SITE_NOTICE_PATH}?surface=launcher`
  try {
    const response = await httpFetch(url, { headers: { Accept: 'application/json' } })
    if (!response.ok) {
      console.warn(`[site-notice] GET returned ${response.status}`)
      return null
    }
    const payload: unknown = await response.json()
    return parseSiteNotice(payload)
  } catch (error) {
    console.warn('[site-notice] fetch failed', error)
    return null
  }
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const VARIANTS: ReadonlySet<string> = new Set(['success', 'alert', 'warning', 'info'])

/**
 * Narrow the wire payload to a `SiteNotice`, or return `null` when it
 * isn't one.
 *
 * The api already validates input and the CHECK constraints guarantee
 * `variant` / `surface`, so the fallbacks below are unreachable in
 * practice. They exist so a hand-edited row or a half-rolled deploy
 * degrades to "no banner" rather than crashing the shell.
 */
function parseSiteNotice(payload: unknown): SiteNotice | null {
  if (typeof payload !== 'object' || payload === null) return null
  const record = payload as Record<string, unknown>

  const id = record.id
  const text = record.text
  if (typeof id !== 'string' || id.length === 0) return null
  if (typeof text !== 'string' || text.length === 0) return null

  if (record.surface !== 'launcher') return null

  // An unrecognised variant renders as neutral `info` rather than
  // being dropped — losing the copy because a colour token moved is
  // the worse failure.
  const variant = VARIANTS.has(record.variant as string)
    ? (record.variant as SiteNotice['variant'])
    : 'info'

  // `linkUrl` is only ever a `null` or an http(s) string: the api
  // rejects anything else on write, and this re-check keeps a
  // `javascript:` URL from reaching `openUrl` even if a row were
  // edited by hand. `linkLabel` is only meaningful with a link —
  // a label with no target is dead UI, same reasoning as the api's
  // own `toDto`.
  const linkUrl = isHttpUrl(record.linkUrl) ? record.linkUrl : null

  return {
    id,
    variant,
    text,
    linkUrl,
    linkLabel: linkUrl && typeof record.linkLabel === 'string' ? record.linkLabel : null,
    isDismissible: record.isDismissible === true,
    // Checked above, so this is always the literal `'launcher'`. Kept
    // on the type so the shape stays a faithful mirror of the api's
    // `SiteNoticeDto` and a future renderer can branch on it without
    // re-deriving the fact.
    surface: 'launcher',
  }
}
