/**
 * Presence heartbeat — periodically POSTs the signed-in user's
 * presence snapshot to the api's `/v1/presence/heartbeat` endpoint.
 *
 * Why this lives in the renderer (not Rust):
 *   - The renderer's `useGameStateContext` already exposes
 *     `gameLaunchState.isRunning` — the authoritative
 *     "is the game process up" signal. Tying the heartbeat here
 *     means we don't have to plumb a separate Rust-side event.
 *   - The renderer already has the bearer token in localStorage
 *     (read by `lib/friends.ts`) and knows the api base URL
 *     (`LAUNCHER_CONFIG.friendsApiBaseUrl`). A separate Rust
 *     command would duplicate both of those.
 *   - The heartbeat is fire-and-forget HTTP — a single fetch
 *     through the shared transport, no auth flow coupling, no retry queue.
 *
 * Status mapping:
 *   - `isRunning === true`  → `status: 'in_game'`, `currentGame: 'ZEmu'`
 *   - `isRunning === false` → `status: 'online'`,  `currentGame: null`
 *
 * Cadence:
 *   - 30 seconds between heartbeats (per the AGENTS.md design call).
 *   - First heartbeat fires 2 seconds after mount so the user's
 *     own badge on other devices lights up quickly after login
 *     without thrashing the API on sign-in.
 *   - The hook is mounted at the top level (`FriendsPresenceHeartbeatHost`
 *     in `main-app.tsx`) so it stays alive when the Friends panel
 *     is closed.
 *
 * Failure posture:
 *   - Errors are swallowed (logged + dropped). A failed heartbeat
 *     just means the user appears offline to friends for a few
 *     seconds; the next interval will retry.
 *   - On app exit, the api's 90s staleness window will flip the
 *     user to offline naturally — no explicit "goodbye" emit
 *     needed.
 */

import { httpFetch } from '@/lib/http-fetch'
import { useEffect, useRef } from 'react'
import { readPersistedToken } from '@/lib/auth'
import { LAUNCHER_CONFIG } from '@/config/launcher'
import { useGameStateContext } from '@/hooks/use-game-state-context'

/** Heartbeat interval in ms. Must match the api's staleness-window thinking. */
const HEARTBEAT_INTERVAL_MS = 30_000

/**
 * First heartbeat delay — long enough that the auth context has
 * settled and the GameStateProvider has loaded, short enough that
 * the user sees "Online" on their other devices within a couple
 * of seconds of signing in.
 */
const INITIAL_HEARTBEAT_DELAY_MS = 2_000

/**
 * Game label sent to the api when the launcher's GameStateProvider
 * reports `isRunning === true`. Hardcoded today (per the design
 * call); a future "show what game you're in" feature would let the
 * renderer pick from a list.
 */
const IN_GAME_LABEL = 'ZEmu' as const

type HeartbeatStatus = 'in_game' | 'online'

function resolveApiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_URL as string | undefined
  if (import.meta.env.DEV && fromEnv) return fromEnv
  return LAUNCHER_CONFIG.friendsApiBaseUrl
}

interface HeartbeatPayload {
  status: HeartbeatStatus
  currentGame: string | null
}

/**
 * Send a single heartbeat. Returns `true` on a 2xx, `false` on
 * anything else (including network failures). The function never
 * throws — failures are logged and reported back to the caller.
 */
async function sendHeartbeat(
  baseUrl: string,
  token: string,
  payload: HeartbeatPayload,
): Promise<boolean> {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/presence/heartbeat`
  try {
    const res = await httpFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      console.warn(
        `[presence] heartbeat ${res.status} ${res.statusText}`,
      )
      return false
    }
    return true
  } catch (err) {
    console.warn(
      `[presence] heartbeat threw: ${err instanceof Error ? err.message : String(err)}`,
    )
    return false
  }
}

/**
 * Mount once at the top level while the user is authenticated.
 *
 * @param enabled - pass `true` when the user has a bearer token.
 *   The hook is a no-op (no interval, no fetch) when `enabled` is
 *   `false`.
 */
export function usePresenceHeartbeat(enabled: boolean) {
  const { state } = useGameStateContext()
  // The renderer's existing public surface for "is the game up" is
  // `state.type === 'PLAYING'` — `useGameState` projects the Rust-
  // side `gameLaunchState.isRunning` into that discriminated union.
  // We mirror it here so we don't need to expose a separate field.
  const isRunning = state.type === 'PLAYING'
  const isRunningRef = useRef(isRunning)
  useEffect(() => {
    isRunningRef.current = isRunning
  }, [isRunning])

  useEffect(() => {
    if (!enabled) return

    const baseUrl = resolveApiBaseUrl()
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const beat = async () => {
      if (cancelled) return
      // Read the token fresh each tick — the user may have logged
      // out between heartbeats and we shouldn't fire after that.
      const token = readPersistedToken()?.token ?? null
      if (!token) return
      const isRunning = isRunningRef.current
      const payload: HeartbeatPayload = isRunning
        ? { status: 'in_game', currentGame: IN_GAME_LABEL }
        : { status: 'online', currentGame: null }
      await sendHeartbeat(baseUrl, token, payload)
      if (cancelled) return
      timer = setTimeout(beat, HEARTBEAT_INTERVAL_MS)
    }

    // First beat fires after a short delay so the auth context has
    // settled. Subsequent beats fire on the 30s interval.
    timer = setTimeout(beat, INITIAL_HEARTBEAT_DELAY_MS)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [enabled])
}
