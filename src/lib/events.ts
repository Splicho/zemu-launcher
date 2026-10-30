/**
 * Upcoming events for the launcher home page.
 *
 * Backed by `GET /v1/events` in the zemu-website api (`apps/api/src/events`):
 * published events whose time range has not finished, soonest first.
 * Drafts never appear, and an event stays listed between its start and end
 * (an 11:00–13:00 event is still shown at 11:30) — the renderer does no
 * status filtering.
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
  /** ISO end timestamp, or null on legacy events (end == start). */
  endsAt: string | null
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
  return (await response.json()) as UpcomingEvent[]
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
  return (await response.json()) as EventFull
}
