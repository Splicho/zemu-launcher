import { httpFetch } from '@/lib/http-fetch'

// ─── URL resolution ───────────────────────────────────────────────────────
//
// All four API consumers (friends, news, streams, leaderboard) share
// `VITE_API_URL`, which points at the root of the api server.

const API_BASE = (() => {
  const fromEnv = import.meta.env.VITE_API_URL as string | undefined
  if (import.meta.env.DEV && fromEnv) return fromEnv
  return 'https://api.zemu.uk'
})()

const STREAMS_PATH = '/streams'

export type StreamInfo = {
  id: string
  user_name: string
  user_login: string
  title: string
  viewer_count: number
  thumbnail_url: string
  profile_image_url?: string
  stream_url?: string
}

export type StreamsResponse = {
  twitch: StreamInfo[]
  kick: StreamInfo[]
  fetchedAt: string
}

export async function fetchStreams(): Promise<StreamsResponse> {
  const res = await httpFetch(`${API_BASE}${STREAMS_PATH}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Streams request failed (HTTP ${res.status})`)
  return res.json()
}
