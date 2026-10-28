/**
 * Shared helpers for the locally-stored ZEmu auth key.
 *
 * The key lives in the OS keychain (Windows Credential Manager on
 * Windows) and is the credential the game receives as `SessionId=`.
 * Two properties make a dedicated module worth having:
 *
 *   1. **It outlives the launcher install.** Credential Manager is not
 *      part of `%APPDATA%`, so uninstalling the launcher or deleting
 *      its app-data folder does NOT remove the key. After an account
 *      switch the old account's key therefore stays on the machine
 *      unless something explicitly replaces it.
 *
 *   2. **Nothing used to replace it.** `AccessKeyProvisioner` bailed
 *      out as soon as *any* key was stored, and sign-out never cleared
 *      it — so a user who deleted account A and signed up as account B
 *      kept launching the game with A's (now orphaned) key. The
 *      launcher and website then disagreed about "the" auth key, and
 *      the game sat on a black screen because the server had no
 *      character for that key.
 *
 * The functions below are the single write path for the key so every
 * caller (sign-in provisioning, the Account page, sign-out) can
 * reconcile instead of blindly skipping, and so UI that gates on the
 * key can be notified when it changes.
 */

/** Fired after the stored key is written or cleared. */
export const AUTH_KEY_CHANGED_EVENT = 'zemu:auth-key-changed'

/** Fired after the stored key is written or cleared. */
export function notifyAuthKeyChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(AUTH_KEY_CHANGED_EVENT))
}

/**
 * Read the saved key, mapping "no key" and keychain errors to `null`.
 * Mirrors `getZemuAuthKey()` but without importing the game HTTP shim
 * (this module is also used by the auth/sign-out path).
 */
export async function readStoredAuthKey(): Promise<string | null> {
  if (typeof window === 'undefined' || !window.launcherAPI?.getAuthKey) {
    return null
  }
  try {
    const value = await window.launcherAPI.getAuthKey()
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

/**
 * Persist `key` only when it differs from what is already stored.
 * Returns `true` when the stored value changed (i.e. listeners should
 * refresh). Never throws on a keychain write failure — callers that
 * care can handle the rejected promise; the Account page and the
 * provisioner both treat it as best-effort.
 */
export async function saveAuthKeyIfChanged(key: string): Promise<boolean> {
  const trimmed = key.trim()
  if (!trimmed) return false
  if (!window.launcherAPI?.setAuthKey) return false

  const existing = await readStoredAuthKey()
  if (existing === trimmed) return false

  await window.launcherAPI.setAuthKey(trimmed)
  notifyAuthKeyChanged()
  return true
}

/**
 * Remove the stored key (account switch / revoked key). Returns `true`
 * when a value was present before the clear, `false` when the store was
 * already empty. The write itself is unconditional: a failed *read*
 * must not leave an account-bound credential behind.
 */
export async function clearStoredAuthKey(): Promise<boolean> {
  if (!window.launcherAPI?.setAuthKey) return false

  const existing = await readStoredAuthKey()
  await window.launcherAPI.setAuthKey('')
  notifyAuthKeyChanged()
  return existing !== null
}
