import { useCallback, useEffect } from 'react'

import { useAuthContext } from '@/contexts/auth-context'
import { fetchMyAuthKey } from '@/lib/auth'
import { useGameStateContext } from '@/hooks/use-game-state-context'

/** Window event the footer dispatches when the user clicks Play while no
 *  access key is provisioned (e.g. an earlier fetch failed). */
export const AUTH_KEY_RETRY_EVENT = 'zemu:auth-key-retry'

/**
 * Provisions the ZEmu access key from the signed-in account.
 *
 * The key is no longer a user-facing gate (see `C:\ZEmu\plan.md`, D3):
 * every account has one, so the launcher fetches it on sign-in instead of
 * sending the user to the onboarding wizard (now retired). This also
 * repairs the features that read the stored key — friends presence, avatar
 * sync — which previously only worked if the wizard had run at least once.
 *
 * Rules:
 * - Never overwrite a key that is already stored.
 * - Only persist an `active` key; a revoked key would just move the
 *   failure downstream.
 * - Failures are silent here. The account menu owns that error surface,
 *   and a provisioning hiccup must never block Play. A failed attempt is
 *   retried on the next sign-in or when the footer dispatches
 *   `AUTH_KEY_RETRY_EVENT`.
 */
export function AccessKeyProvisioner() {
  const { status, token } = useAuthContext()
  const { refreshAuthKey } = useGameStateContext()
  // Destructured so the callback's dependency array matches the value it
  // actually closes over (`token?.token` would make the compiler infer the
  // whole `token` object).
  const bearer = token?.token

  const provision = useCallback(async () => {
    if (!bearer) return
    try {
      const existing = await window.launcherAPI?.getAuthKey?.()
      if (existing && existing.trim().length > 0) return

      const result = await fetchMyAuthKey(bearer)
      if (!result.ok) return
      if (result.status !== 'active' || !result.key) return

      await window.launcherAPI?.setAuthKey?.(result.key)
      // Re-read the key into game state so `AUTH_KEY_REQUIRED` clears
      // without a restart.
      await refreshAuthKey()
    } catch {
      // Non-fatal: the account menu / Play click is the retry surface.
    }
  }, [bearer, refreshAuthKey])

  useEffect(() => {
    if (status !== 'authed') return
    void provision()
  }, [status, provision])

  // Retry hook for the footer: clicking Play with no key asks again
  // instead of routing into a wizard that no longer exists.
  useEffect(() => {
    if (status !== 'authed') return
    const onRetry = () => void provision()
    window.addEventListener(AUTH_KEY_RETRY_EVENT, onRetry)
    return () => window.removeEventListener(AUTH_KEY_RETRY_EVENT, onRetry)
  }, [status, provision])

  return null
}
