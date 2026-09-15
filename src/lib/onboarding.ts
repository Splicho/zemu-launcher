/**
 * Persistence for the "user has completed first-run onboarding" state.
 *
 * The first-run wizard collects three things in order:
 *   1. Auth key (saved locally, no server validation).
 *   2. Game install folder (chosen by the user).
 *   3. Base game (auto-downloaded via SteamCMD, or manually via the
 *      Steam depot console).
 *
 * After the wizard finishes we flip this flag to `'1'` so subsequent
 * launches route straight to `/` instead of `/onboarding`. The flag is
 * intentionally best-effort: `localStorage` can throw in private-mode
 * or sandboxed contexts, so every helper is wrapped in try/catch and
 * returns a safe default. Losing the flag just means the user will
 * see the wizard again on next launch — not a destructive outcome.
 *
 * The wizard's `setupChecks` (auth key + folder + base-game presence on
 * disk) is the authoritative gate; this flag is just a hint to skip the
 * wizard for users who have already finished it.
 */

const STORAGE_KEY = 'zemu-launcher.onboarding-completed'

export const ONBOARDING_STORAGE_KEY = STORAGE_KEY

export function hasCompletedOnboarding(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function markOnboardingCompleted(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    /* best-effort — losing the flag just shows the wizard again next launch */
  }
}

export function clearOnboardingCompleted(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* best-effort */
  }
}
