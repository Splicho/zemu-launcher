import { useEffect, useState } from 'react'

/**
 * Login methods the launcher offers. Kept in lockstep with the
 * `Provider` type in `lib/auth.ts` (which only lists OAuth
 * providers; `email` is added here because it's a valid login
 * surface even though it doesn't go through `initiateOAuth`).
 */
export type LoginMethod = 'discord' | 'steam' | 'email'

const LAST_USED_PROVIDER_KEY = 'zemu-launcher.lastUsedLoginMethod'

/**
 * Persist which login surface (`discord` / `steam` / `email`) the
 * user picked last time, and surface a "last used" badge on the
 * matching button on the next session.
 *
 * Why we remember it at all: the launcher's login screen shows
 * three roughly-equal-weight buttons. Returning users overwhelmingly
 * want to use the same provider as last time — they don't re-pick
 * Discord every morning, they just click it. Marking the previously
 * used button with a small "Last used" badge reduces the visual
 * cost of picking the same button every time and makes the layout
 * feel personal.
 *
 * Storage: `localStorage`, scoped behind the launcher's namespace
 * (`zemu-launcher.*`). The same storage already holds
 * `zemu-launcher.auth` for the bearer token and
 * `zemu-launcher.language` for the i18n preference, so adding one
 * more key fits the existing pattern.
 *
 * When we save: as soon as the user *attempts* a login, not after
 * it succeeds. A user who got `user_banned` on Discord and then
 * successfully signed in via Steam still saw Discord as their
 * preferred surface until we fixed the code — that was a confusing
 * "the badge is on the button that doesn't work for me" experience.
 * Recording the attempt rather than the success mirrors emudevs'
 * `useLastUsedProvider` and keeps the badge pointing at the
 * button the user actually clicked.
 *
 * When we read: only on mount. The badge updates across sessions,
 * not within a single session — saving mid-session and re-rendering
 * would just make the badge flicker between clicks and feel
 * unreliable.
 */
export function useLastUsedProvider(): {
  lastUsedProvider: LoginMethod | null
  saveLastUsedProvider: (method: LoginMethod) => void
  clearLastUsedProvider: () => void
} {
  const [lastUsedProvider, setLastUsedProvider] =
    useState<LoginMethod | null>(null)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(LAST_USED_PROVIDER_KEY)
      if (
        stored === 'discord' ||
        stored === 'steam' ||
        stored === 'email'
      ) {
        setLastUsedProvider(stored)
      }
    } catch {
      // localStorage can throw in private windows / locked-down
      // sandboxes; fall back to "no remembered provider" rather than
      // blowing up the whole login screen.
    }
  }, [])

  const saveLastUsedProvider = (method: LoginMethod) => {
    try {
      localStorage.setItem(LAST_USED_PROVIDER_KEY, method)
      // Intentionally do NOT call setLastUsedProvider here — see the
      // "when we read" note above. The badge updates on the next
      // launch, not on the click that triggered the save.
    } catch {
      // best-effort: ignore storage failures.
    }
  }

  const clearLastUsedProvider = () => {
    try {
      localStorage.removeItem(LAST_USED_PROVIDER_KEY)
    } catch {
      // best-effort: ignore storage failures.
    }
    setLastUsedProvider(null)
  }

  return {
    lastUsedProvider,
    saveLastUsedProvider,
    clearLastUsedProvider,
  }
}
