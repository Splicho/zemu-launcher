/**
 * Upcoming events for the launcher home page.
 *
 * Backed by `GET /v1/events` in the zemu-website api (`apps/api/src/events`):
 * published events whose time range has not finished, soonest first.
 * Drafts never appear, and an event stays listed between its start and end
 * (an 11:00–13:00 event is still shown at 11:30) — the renderer does no
 * status filtering. Open-ended events (`endsAt === null`) have no end to
 * pass, so they stay listed until staff close them.
 *
 * Public endpoint: same anonymous transport as the news feed (native HTTP
 * on desktop, browser fetch in previews).
 */

import { LAUNCHER_CONFIG } from '@/config/launcher'
import { httpFetch } from '@/lib/http-fetch'

export interface UpcomingEvent {
  id: string
  title: string
  /** Full public URL, or null when the event has no cover image. */
  coverImageUrl: string | null
  coverAlt: string | null
  /** ISO start timestamp. */
  startsAt: string
  /**
   * ISO end timestamp. `null` means the event is **open-ended**: no
   * scheduled end, so it stays live until staff close it from the admin.
   * Never fall back to `startsAt` for a null end — that reads as "ended
   * the instant it started".
   */
  endsAt: string | null
  /**
   * Redundant with `endsAt === null`, but explicit: branch on one boolean
   * instead of reasoning about the null.
   */
  isOpenEnded: boolean
  /** Whether to render the live “Starts in …” countdown. */
  showStartCountdown: boolean
  /**
   * Whether to render the live “Ends in …” countdown. Always false for an
   * open-ended event — there is no end to count toward.
   */
  showEndCountdown: boolean
}

/** Single event, including the rich-text body. */
export interface EventFull extends UpcomingEvent {
  /** Sanitised HTML. Rendered through `NewsBody`, same as news posts. */
  descriptionHtml: string
  publishedAt: string
}

function getEventsApiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_URL as string | undefined
  if (import.meta.env.DEV && fromEnv) return `${fromEnv}/v1/events`
  return LAUNCHER_CONFIG.eventsApiBaseUrl
}

const EVENTS_API_BASE = getEventsApiBaseUrl()

/**
 * Fill in the open-ended / countdown fields on a wire payload.
 *
 * They were added to the api after the first events release, so an older
 * backend omits them entirely. Normalising at the boundary means such a
 * payload keeps the pre-open-ended behaviour (scheduled events render
 * exactly as before) instead of `undefined` leaking into a conditional.
 */
function normaliseEvent<T extends UpcomingEvent>(raw: T): T {
  const endsAt = raw.endsAt ?? null
  return {
    ...raw,
    endsAt,
    isOpenEnded: raw.isOpenEnded ?? (endsAt === null),
    showStartCountdown: raw.showStartCountdown ?? true,
    showEndCountdown: raw.showEndCountdown ?? true,
  }
}

/**
 * Fetch the next `limit` published events. Throws on non-2xx / network
 * failure so the caller can render its own error state; an empty array is
 * a successful "calendar is clear" response.
 */
export async function fetchUpcomingEvents(limit = 5): Promise<UpcomingEvent[]> {
  const response = await httpFetch(`${EVENTS_API_BASE}?limit=${limit}`, {
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`Upcoming events request failed (HTTP ${response.status})`)
  }
  const rows = (await response.json()) as UpcomingEvent[]
  return rows.map(normaliseEvent)
}

/**
 * Fetch one published event by id. Returns `null` on 404 — a draft and an
 * unknown id are indistinguishable on the public API by design. Throws on
 * any other non-2xx or network failure.
 *
 * Events have no slug column, so the launcher's route carries the primary
 * key: `#/event/<id>`.
 */
export async function fetchEventById(id: string): Promise<EventFull | null> {
  const response = await httpFetch(`${EVENTS_API_BASE}/${encodeURIComponent(id)}`, {
    headers: { Accept: 'application/json' },
  })
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`Event request failed (HTTP ${response.status})`)
  }
  return normaliseEvent((await response.json()) as EventFull)
}
