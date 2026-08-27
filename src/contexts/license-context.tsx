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

  // Clear on logout. We don't include `license` in the deps because
  // `reset` is stable; the effect should fire only when auth flips.
  useEffect(() => {
    if (authStatus !== 'authed') {
      license.reset()
    }
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