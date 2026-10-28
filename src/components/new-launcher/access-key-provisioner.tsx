import { useCallback, useEffect } from 'react'

import { useAuthContext } from '@/contexts/auth-context'
import { fetchMyAuthKey } from '@/lib/auth'
import {
  clearStoredAuthKey,
  saveAuthKeyIfChanged,
} from '@/lib/auth-key'
import { useGameStateContext } from '@/hooks/use-game-state-context'

/** Window event the footer dispatches when the user clicks Play while no
 *  access key is provisioned (e.g. an earlier fetch failed). */
export const AUTH_KEY_RETRY_EVENT = 'zemu:auth-key-retry'

/**
 * Provisions and reconciles the ZEmu access key from the signed-in
 * account.
 *
 * The key is no longer a user-facing gate (see `C:\ZEmu\plan.md`, D3):
 * every account has one, so the launcher fetches it on sign-in instead of
 * sending the user to the onboarding wizard (now retired). This also
 * repairs the features that read the stored key — friends presence, avatar
 * sync — which previously only worked if the wizard had run at least once.
 *
 * Rules:
 * - The server is the source of truth: on every `authed` resolution the
 *   launcher compares the stored key with `GET /api/launcher/auth/my-key`
 *   and writes the server value when it differs.
 * - A `revoked` key is cleared locally (never launch with a key an admin
 *   disabled), and so is the "server says this account has no key" case —
 *   otherwise a key inherited from a previous account would be used.
 * - A transport failure is silent and leaves the stored key untouched, so
 *   an offline start can still launch the game.
 * - A failed attempt is retried on the next sign-in or when the footer
 *   dispatches `AUTH_KEY_RETRY_EVENT`.
 *
 * ## Why reconcile instead of "never overwrite"
 *
 * The previous implementation returned early whenever a key was already
 * stored. That is fine for a re-login on the same account, but wrong after
 * an account switch: the OS keychain survives both an uninstall and a
 * deleted `%APPDATA%`, so the new account inherited the old account's key
 * and the game black-screened (no character for that key). Reconciling on
 * every sign-in makes the switch self-healing; the only cost is one
 * authenticated GET per launch.
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
      const result = await fetchMyAuthKey(bearer)
      // Transport / auth failure: keep whatever is stored. An offline
      // launch must still work with the last known-good key.
      if (!result.ok) return

      if (result.status === 'revoked') {
        if (await clearStoredAuthKey()) await refreshAuthKey()
        return
      }

      if (result.status !== 'active' || !result.key) {
        // The signed-in account has no key yet. Do not keep a key that
        // belongs to a different account on disk.
        if (await clearStoredAuthKey()) await refreshAuthKey()
        return
      }

      if (await saveAuthKeyIfChanged(result.key)) {
        // Re-read the key into game state so `AUTH_KEY_REQUIRED` clears
        // without a restart.
        await refreshAuthKey()
      }
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
