import { fetchPublicApi } from '@/lib/public-api'

const API_BASE = import.meta.env.VITE_STREAMS_API_BASE_URL ?? 'https://api.zemu.uk'

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
  const res = await fetchPublicApi(`${API_BASE}/streams`)
  if (!res.ok) throw new Error(`Streams request failed (HTTP ${res.status})`)
  return res.json()
}
