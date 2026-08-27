/**
 * Single shared instance of `useLicense()` for the whole app.
 *
 * Why this exists (mirrors `AuthContext`): every component that calls
 * `useLicense` would otherwise get its own in-memory `LicenseRecord`
 * and its own mount-time `getPcIdentifier` effect — they'd diverge
 * the moment one of them did a redeem and the others didn't. We
 * instantiate the hook once at the top of the tree and pass the
 * returned object through context, so every consumer agrees on the
 * current bound key.
 *
 * Also gates on auth: when the user signs out we `reset()` the license
 * record so the next sign-in starts from a clean slate. Without this
 * the record would survive logout and the next sign-in would believe
 * the machine is still bound.
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from 'react'

import { useAuthContext } from '@/contexts/auth-context'
import {
  useLicense,
  type UseLicenseResult,
} from '@/hooks/use-license'

const LicenseContext = createContext<UseLicenseResult | null>(null)

export function LicenseProvider({ children }: { children: ReactNode }) {
  const { status: authStatus } = useAuthContext()
  // Only run the license hook when we're authed — the `/v1/licenses/validate`
  // endpoint is unauthenticated, but we don't want to surface "License
  // required" to a user who hasn't signed in yet (they're on the login
  // page and the modal would be unreachable anyway).
  const license = useLicense({ enabled: authStatus === 'authed' })

  // Clear the persisted record on a real sign-out — but only when we
  // transition out of an authed state, not during the startup loading
  // window. On a cold launch `authStatus` starts at `'loading'` (we're
  // introspecting a persisted token) and only flips to `'authed'`
  // after the introspect resolves. If the previous render was `'authed'`
  // and now it's anything else, that's a genuine logout — the user
  // explicitly chose to sign out (or their session was rejected) and we
  // should clear the disk record. Anything else (initial mount, the
  // `loading` window, a non-authed page tab) leaves the cached record
  // alone so the next sign-in picks it up. Without this guard the
  // loading window would call `reset()` and delete `license-store.json`
  // before `useLicense`'s mount effect could read it back.
  const previousAuthedRef = useRef(authStatus === 'authed')
  useEffect(() => {
    const isAuthedNow = authStatus === 'authed'
    if (previousAuthedRef.current && !isAuthedNow) {
      license.reset()
    }
    previousAuthedRef.current = isAuthedNow
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus])

  return (
    <LicenseContext.Provider value={license}>{children}</LicenseContext.Provider>
  )
}

export function useLicenseContext(): UseLicenseResult {
  const ctx = useContext(LicenseContext)
  if (!ctx) {
    throw new Error(
      'useLicenseContext must be used inside <LicenseProvider>. ' +
        'Wrap your tree in main-app.tsx.',
    )
  }
  return ctx
}