/**
 * Player-icon client for the desktop launcher.
 *
 * Talks to the game server's `/avatar` endpoints over plain HTTP
 * (see `LAUNCHER-API (1).md` §4 — "Player icon"). The endpoints
 * accept PNG or JPEG bytes at exactly 64x64 and ≤ 256 KB; the
 * server validates and rejects oversized / wrong-sized uploads
 * with a 400 carrying the validator's `required` shape
 * (`{ pixels, maxBytes, formats }`).
 *
 * Auth: `Authorization: Bearer <ZEmu auth key>`, same key the
 * friends / party clients use. Public reads (`GET /avatar/<id>`,
 * `GET /avatars`) don't need auth.
 *
 * What this file does:
 *
 *   1. `getAvatarUrl(characterId)` — returns an absolute URL on
 *      the game server. The base `/avatar/<id>` URL never changes
 *      after upload, so callers append `?v=<stamp>` (from
 *      `loadAvatarStamps`) to bust caches when the icon updates.
 *
 *   2. `loadAvatarStamps()` — fetches `GET /avatars` once and
 *      returns the `{ characterId: stamp }` map. In-memory cache
 *      (callers bust with `bustAvatarStampCache()` after a
 *      successful upload / delete).
 *
 *   3. `uploadFromSourceUrl(sourceUrl)` — fetches a source image
 *      (typically the user's OAuth provider avatar at
 *      `useAuth().user.image`, or whatever
 *      `readPersistedToken().image` holds), downsamples it to a
 *      64x64 PNG with an offscreen canvas, and POSTs the result
 *      to the game server.
 *
 *      Why not prompt the user for a 64x64 upload? Per the design
 *      note: our ~5k users already have an avatar on the website
 *      and on the OAuth provider. Re-prompting for a 64x64 square
 *      would be net-negative — it forces them to crop and re-pick
 *      an image they already have. We instead pick the best
 *      source we can reach from the launcher and downsample.
 *
 *      The OAuth provider avatar (`useAuth().user.image`) is the
 *      "good enough" source we always have: it's the user's
 *      Discord/Steam profile picture that they picked once, and
 *      it's already on the launcher's persisted token. The
 *      website's chosen R2 avatar would be even better but the
 *      `/v1/me/profile` api endpoint accepts Auth.js session
 *      cookies only — plumbing a launcher-bearer variant is out of
 *      scope here. The function takes `sourceUrl` as a
 *      parameter so a future caller can plug in a different source
 *      (R2 URL once we have it, a user-picked file once we have
 *      a picker, …) without touching the canvas/POST plumbing.
 *
 *   4. `deleteAvatar()` — `DELETE /avatar`. Mirror of
 *      `uploadFromSourceUrl` for the rare "I want to revert to
 *      the default" case.
 *
 * Errors are surfaced as thrown `GameApiError`s (see
 * `zemu-game-api.ts`); the auto-upload in `useAvatarSync`
 * swallows them so a flaky game server doesn't spam the user.
 */
import {
  gameFetch,
  GameApiError,
  getZemuAuthKey,
  GAME_API_BASE_URL,
  mapGameApiAuthReason,
} from '@/lib/zemu-game-api'
import { httpFetch } from '@/lib/http-fetch'

// ─── Constants ───────────────────────────────────────────────────────────

/** Required pixel edge for `POST /avatar` per the LAUNCHER-API doc. */
const AVATAR_PIXELS = 64
/** Maximum allowed byte size per the same doc. */
const AVATAR_MAX_BYTES = 256 * 1024

// ─── URL helpers ─────────────────────────────────────────────────────────

/**
 * Absolute URL on the game server for a given character. Pass a
 * `stamp` from `loadAvatarStamps()` (or `Date.now()` if you have
 * no better option) as a cache-buster since the path never changes
 * after upload.
 */
export function getAvatarUrl(characterId: string | number, stamp?: string | number | null): string {
  const base = `${GAME_API_BASE_URL}/avatar/${characterId}`
  if (stamp === undefined || stamp === null) return base
  return `${base}?v=${encodeURIComponent(String(stamp))}`
}

// ─── Stamp cache ─────────────────────────────────────────────────────────

/** Per-character upload timestamp, returned by `GET /avatars`. */
export interface AvatarStamps {
  /** ISO timestamp / opaque token; the doc doesn't pin a format. */
  stamps: Record<string, string>
}

/** In-memory cache of the most recent `GET /avatars` response. */
let cachedStamps: AvatarStamps | null = null
let cachedStampsFetchedAt = 0
const STAMPS_TTL_MS = 5 * 60 * 1000

/**
 * Fetch and cache the per-character avatar stamps. The endpoint is
 * public (no auth), cheap (~50 bytes for an empty team), and lets
 * us cache-bust every `<img src="/avatar/<id>">` on the friends
 * panel after a successful upload.
 *
 * Refresh the cache with `bustAvatarStampCache()` after uploads.
 */
export async function loadAvatarStamps(force = false): Promise<AvatarStamps> {
  if (!force && cachedStamps && Date.now() - cachedStampsFetchedAt < STAMPS_TTL_MS) {
    return cachedStamps
  }
  try {
    const payload = await gameFetch<{
      pixels?: number
      avatars?: Array<{ characterId: string; url: string; stamp: string }>
    }>('/avatars', {
      bearer: null,
      silent: true,
    })
    const stamps: Record<string, string> = {}
    for (const entry of payload.avatars ?? []) {
      if (entry.characterId && entry.stamp) {
        stamps[entry.characterId] = entry.stamp
      }
    }
    cachedStamps = { stamps }
    cachedStampsFetchedAt = Date.now()
    return cachedStamps
  } catch (error) {
    if (error instanceof GameApiError && error.status === 401) {
      // /avatars is public per the doc — 401 here would be very
      // surprising. Treat it as "no stamps yet" so the caller can
      // proceed with `stamp=Date.now()` fallback.
      return { stamps: {} }
    }
    console.warn('[avatar] failed to fetch /avatars', error)
    return cachedStamps ?? { stamps: {} }
  }
}

/** Force the next `loadAvatarStamps()` to re-fetch. Call after
 *  successful upload / delete so the next render sees the new
 *  stamp. */
export function bustAvatarStampCache(): void {
  cachedStamps = null
  cachedStampsFetchedAt = 0
}

// ─── Image processing ────────────────────────────────────────────────────

/**
 * Fetch a remote image, draw it to a 64x64 canvas, return the
 * resulting PNG bytes. The canvas downsample uses high-quality
 * smoothing so a 512x512 source looks better than box-filtered
 * garbage at small sizes.
 *
 * Why a Tauri command instead of `fetch(url, { mode: 'cors' })`:
 *   - The webview enforces CORS on `fetch`. CDNs that don't send
 *     `Access-Control-Allow-Origin` silently reject the request
 *     ("Failed to fetch") even though the same URL renders fine
 *     in an `<img>` tag (browsers don't enforce CORS on image
 *     elements). The launcher's account dropdown uses `<img>` so
 *     the user sees their own avatar, but `fetchAndDownscale` is
 *     called with `mode: 'cors'` to keep the canvas untainted
 *     and that path is the one that 404s on a missing-CORS CDN.
 *   - Routing the request through Rust + `reqwest` sidesteps CORS
 *     entirely. The bytes come back the same shape the webview's
 *     `fetch` would have received, but without the browser's
 *     preflight / opaque-response gymnastics. The base64 string
 *     decodes back into a typed `Blob` and the existing canvas
 *     pipeline runs unchanged.
 */
async function fetchAndDownscale(sourceUrl: string): Promise<Blob> {
  // The launcher's persisted `token.image` should be an absolute
  // URL on a CDN (Discord/Steam/R2). Historically the auth app's
  // `publicUrlFor` could silently return the *bare R2 key* when
  // `R2_PUBLIC_URL` was unset — and the launcher would then call
  // `fetch("avatars/<userId>/<hash>.jpg")`, which the browser
  // resolves against the launcher's webview origin (`tauri.localhost`)
  // and silently 404s. Catch the obviously-broken shape up front
  // so the user gets a clear log message instead of the generic
  // "The source image could not be decoded" error from
  // `createImageBitmap` on the empty/HTML 404 body.
  if (!/^https?:\/\//i.test(sourceUrl)) {
    throw new Error(
      `avatar source url is not absolute (got "${sourceUrl}")`,
    )
  }
  const blob = await fetchAvatarBlob(sourceUrl)
  // `createImageBitmap` throws "The source image could not be
  // decoded" on a non-image body. Some CDNs return a 200 + HTML
  // error page rather than a real 4xx — surface the content type
  // in the failure message so the user can tell the difference
  // between "wrong URL" and "URL points at HTML".
  try {
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = AVATAR_PIXELS
    canvas.height = AVATAR_PIXELS
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d context unavailable')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    // Source rectangle: take the centre square (Twitter / Discord avatars
    // are already square, but be defensive) and draw to the full 64x64
    // canvas.
    const srcSide = Math.min(bitmap.width, bitmap.height)
    const srcX = Math.floor((bitmap.width - srcSide) / 2)
    const srcY = Math.floor((bitmap.height - srcSide) / 2)
    ctx.drawImage(
      bitmap,
      srcX,
      srcY,
      srcSide,
      srcSide,
      0,
      0,
      AVATAR_PIXELS,
      AVATAR_PIXELS,
    )
    const out = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error('toBlob failed'))),
        'image/png',
      )
    })
    bitmap.close?.()
    // Server cap is 256 KB. PNG downsamples of avatar-class images
    // land well under that, but a sourceless flatten of a busy image
    // could spike above. The server rejects with a clear `400 +
    // required.maxBytes` so we don't need a client pre-check.
    if (out.size > AVATAR_MAX_BYTES) {
      throw new Error(`avatar too large (${out.size} bytes > ${AVATAR_MAX_BYTES})`)
    }
    return out
  } catch (err) {
    if (
      err instanceof Error &&
      /source image could not be decoded/i.test(err.message)
    ) {
      throw new Error(
        `avatar source decoded as non-image (content-type=${blob.type || 'unknown'}, size=${blob.size} bytes)`,
      )
    }
    throw err
  }
}

/**
 * Download a remote image as a typed `Blob` via the Rust-side
 * `avatar_fetch_bytes` command. Returns a `Blob` with the upstream
 * Content-Type so `createImageBitmap` and friends see the correct
 * MIME for the body.
 *
 * Outside of Tauri (e.g. the Vite dev server with no Rust side
 * running) we fall back to a plain `fetch(url, { mode: 'no-cors' })`
 * so the dev experience still works. The `mode: 'no-cors'` response
 * is opaque to JS — `createImageBitmap` doesn't care, but the
 * canvas would be tainted and `toBlob` would throw. That's fine
 * in dev because we never `POST` the result anywhere — the dev
 * avatar-sync is purely a smoke test.
 */
async function fetchAvatarBlob(sourceUrl: string): Promise<Blob> {
  if (
    typeof window !== 'undefined' &&
    window.launcherAPI &&
    typeof window.launcherAPI.fetchAvatarBytes === 'function'
  ) {
    const result = await window.launcherAPI.fetchAvatarBytes(sourceUrl)
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`avatar source ${result.status}`)
    }
    // The Rust struct uses `#[serde(rename_all = "camelCase")]` —
    // if a future refactor drops the rename, `bodyBase64` comes
    // back as `undefined` and `atob` throws the unhelpful
    // "The string to be decoded is not correctly encoded."
    // message. Catch that shape and surface something actionable
    // so the IPC mismatch is obvious in the dev console rather
    // than getting logged as a one-off "avatar sync skipped".
    if (typeof result.bodyBase64 !== 'string' || result.bodyBase64.length === 0) {
      throw new Error(
        `avatar IPC payload missing bodyBase64 (got keys=${Object.keys(result).join(',')})`,
      )
    }
    let binary: string
    try {
      binary = atob(result.bodyBase64)
    } catch (err) {
      throw new Error(
        `avatar base64 decode failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return new Blob([bytes], { type: result.contentType })
  }
  // Dev fallback (vite dev server, no Tauri shell). Same shape
  // as the prod path but vulnerable to the CORS issue described
  // on `fetchAndDownscale`.
  const response = await fetch(sourceUrl, { mode: 'no-cors' })
  if (!response.ok) {
    throw new Error(`avatar source ${response.status}`)
  }
  return response.blob()
}

// ─── Upload / delete ─────────────────────────────────────────────────────

export interface UploadResult {
  ok: boolean
  url: string | null
  contentType: string | null
  bytes: number | null
  /** Game-server rejection reason. */
  reason?: string | null
}

/**
 * Fetch the given source image, downsample to 64x64 PNG, POST to
 * the game server's `/avatar` endpoint. Returns the parsed
 * response (or a `{ ok: false, reason }` shape on failure).
 *
 * Pass `null` to skip the source-fetch path (e.g. if the caller
 * has its own blob — useful for tests).
 */
export async function uploadFromSourceUrl(
  sourceUrl: string | null | undefined,
): Promise<UploadResult> {
  if (!sourceUrl) {
    return { ok: false, url: null, contentType: null, bytes: null, reason: 'no_source' }
  }
  let blob: Blob
  try {
    blob = await fetchAndDownscale(sourceUrl)
  } catch (error) {
    console.warn('[avatar] downscale failed', error)
    return {
      ok: false,
      url: null,
      contentType: null,
      bytes: null,
      reason: error instanceof Error ? error.message : 'downscale_failed',
    }
  }
  const authKey = await getZemuAuthKey()
  if (!authKey) {
    return {
      ok: false,
      url: null,
      contentType: null,
      bytes: null,
      reason: 'unauthenticated',
    }
  }

  // Use `httpFetch` directly rather than `gameFetch` because the
  // body is binary (PNG bytes), not JSON. `gameFetch`'s default
  // Content-Type negotiation doesn't apply; we set it ourselves.
  // Still `httpFetch` and not `fetch`: on desktop the upload has
  // to go through Rust or the WebView rejects it on CORS.
  try {
    const response = await httpFetch(`${GAME_API_BASE_URL}/avatar`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authKey}`,
        'Content-Type': 'image/png',
      },
      body: blob,
    })
    if (!response.ok) {
      const text = await response.text()
      let parsedError: string | null = null
      try {
        const parsed = JSON.parse(text)
        if (
          parsed &&
          typeof parsed === 'object' &&
          typeof (parsed as { error?: unknown }).error === 'string'
        ) {
          parsedError = (parsed as { error: string }).error
        }
      } catch {
        // leave as text
      }
      console.warn('[avatar] upload HTTP', response.status, text)
      return {
        ok: false,
        url: null,
        contentType: null,
        bytes: blob.size,
        reason: parsedError ?? `http_${response.status}`,
      }
    }
    const payload = (await response.json()) as {
      ok?: boolean
      url?: string
      contentType?: string
      bytes?: number
    }
    bustAvatarStampCache()
    return {
      ok: payload.ok === true,
      url: typeof payload.url === 'string' ? payload.url : null,
      contentType: typeof payload.contentType === 'string' ? payload.contentType : null,
      bytes: typeof payload.bytes === 'number' ? payload.bytes : blob.size,
    }
  } catch (error) {
    console.warn('[avatar] upload network error', error)
    return {
      ok: false,
      url: null,
      contentType: null,
      bytes: null,
      reason: 'network_error',
    }
  }
}

export interface DeleteResult {
  ok: boolean
  reason?: string | null
}

export async function deleteAvatar(): Promise<DeleteResult> {
  try {
    await gameFetch<unknown>('/avatar', { method: 'DELETE' })
    bustAvatarStampCache()
    return { ok: true }
  } catch (error) {
    if (error instanceof GameApiError) {
      // Same 401 taxonomy as friends / party — see
      // `mapGameApiAuthReason` for the breakdown.
      if (error.status === 401) {
        return { ok: false, reason: mapGameApiAuthReason(error) }
      }
      return { ok: false, reason: `http_${error.status}` }
    }
    console.warn('[avatar] delete failed', error)
    return { ok: false, reason: 'network_error' }
  }
}
