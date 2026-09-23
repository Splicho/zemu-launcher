/**
 * Fire-and-forget avatar sync — mirrors the friends + presence top-
 * level hosts in `main-app.tsx`.
 *
 * Why this exists: the new game server's `/avatar` endpoint accepts
 * exactly 64x64 PNG / JPEG bytes, ≤ 256 KB, and the user doesn't
 * need to know about any of that. We've already done the design
 * decision not to re-prompt for a fresh avatar (per the rework
 * notes), so this hook takes whatever avatar URL the launcher's
 * auth session already knows about (typically `useAuth().user.image`
 * — the OAuth provider's profile picture), downsamples it to 64x64,
 * and POSTs once per source URL.
 *
 * Failure mode: any failure (no source URL, fetch CORS-blocked,
 * canvas taint, server 4xx, network down) is logged and swallowed.
 * Surfacing a toast for "your avatar didn't upload" would be far
 * worse than the silent skip — most users don't care.
 *
 * Idempotency: keyed by the source URL. Same URL → no re-upload.
 * Different URL (user re-signed-in with a different provider, admin
 * reset the auth key, etc.) → re-upload. Cleared on sign-out so
 * the next sign-in gets a fresh attempt.
 */
import { useEffect, useRef } from 'react'

import { useAuthContext } from '@/contexts/auth-context'
import { useZemuAuthKeyReady } from '@/hooks/use-friends'
import { uploadFromSourceUrl } from '@/lib/avatar'
import { friendsDebugLog } from '@/lib/zemu-game-api'
import { readPersistedToken } from '@/lib/auth'

export function useAvatarSync(enabled: boolean) {
  const { status } = useAuthContext()
  const authKeyReady = useZemuAuthKeyReady(enabled)
  /** Source URL we've already attempted. Acts as a one-shot
   *  de-duplication per session. Cleared when the user signs out so
   *  the next sign-in gets a fresh attempt. */
  const lastTriedSourceRef = useRef<string | null>(null)

  // Derived up-front so the effect can read it from the deps array
  // without tripping react-hooks/exhaustive-deps. The launcher's
  // auth context exposes the token, not the user payload directly;
  // `readPersistedToken` returns the same JSON we wrote at login,
  // including the OAuth provider's `image` (Discord/Steam/whatever
  // the user linked). The website's R2 avatar would be better but
  // `/v1/me/profile` is session-cookie-only and the launcher
  // carries bearer credentials.
  const persistedImage = readPersistedToken()?.image ?? null
  const sourceUrl =
    typeof persistedImage === 'string' && persistedImage.length > 0
      ? persistedImage
      : null

  useEffect(() => {
    if (!enabled || status !== 'authed') {
      lastTriedSourceRef.current = null
      return
    }
    if (!authKeyReady) return

    if (!sourceUrl) {
      // No OAuth avatar. Skip silently — most users will pick one
      // up eventually via re-linking the provider.
      void friendsDebugLog.log(
        'avatar-sync',
        'no source url on user record',
      )
      return
    }

    if (!/^https?:\/\//i.test(sourceUrl)) {
      // Persisted token has a bare relative path (e.g.
      // `avatars/<userId>/<hash>.jpg`) instead of an absolute URL.
      // This used to surface as a never-ending
      // "The source image could not be decoded" loop because
      // `fetch("avatars/...jpg")` resolved against the launcher's
      // webview origin (`tauri.localhost`) and silently 404'd. The
      // root cause was the auth app's `publicUrlFor` silently
      // returning the bare key when `R2_PUBLIC_URL` was unset on
      // the auth server. We've since hardened that helper (it
      // throws now) — so once the auth app is redeployed with
      // `R2_PUBLIC_URL=https://cdn.zemu.uk` set in its environment,
      // `/api/launcher/user` will mint real URLs and this guard
      // becomes a no-op for fresh logins. Stale persisted tokens
      // (the user signed in before the env var was set) still hit
      // this branch until they sign out and back in.
      void friendsDebugLog.log(
        'avatar-sync',
        `source url is not absolute; skipping upload (value="${sourceUrl}"). ` +
          `Auth app's R2_PUBLIC_URL is likely unset — set it on the auth server ` +
          `and ask the user to sign out + back in to refresh token.image.`,
      )
      return
    }

    if (lastTriedSourceRef.current === sourceUrl) {
      // Already attempted this URL in this session. Don't spam the
      // server; the user can re-trigger via a manual upload path
      // (not implemented today).
      return
    }
    lastTriedSourceRef.current = sourceUrl

    void (async () => {
      void friendsDebugLog.log(
        'avatar-sync',
        `attempting upload from ${sourceUrl}`,
      )
      const result = await uploadFromSourceUrl(sourceUrl)
      if (result.ok) {
        void friendsDebugLog.log(
          'avatar-sync',
          `uploaded ${result.bytes} bytes (${result.contentType})`,
        )
      } else {
        void friendsDebugLog.log(
          'avatar-sync',
          `skipped: ${result.reason ?? 'unknown'}`,
        )
      }
    })()
  }, [enabled, status, authKeyReady, sourceUrl])
}
