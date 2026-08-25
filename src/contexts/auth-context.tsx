import {
  createContext,
  useContext,
  type ReactNode,
} from 'react'

import {
  useAuth,
  type UseAuthResult,
} from '@/hooks/use-auth'

/**
 * Single shared instance of `useAuth()` for the whole app.
 *
 * Why this exists: `useAuth` is a stateful hook. Each component that
 * calls it gets its own `useState` slots, its own introspect effect,
 * its own lifecycle. When `LoginPage` and `App` both called `useAuth`,
 * they had *independent* `token` / `status` state — `App` had no idea
 * that `LoginPage` had finished OAuth and flipped its status to
 * `'authed'`. The persisted token was shared via localStorage but the
 * React state wasn't, so `App` kept rendering `LoginPage` long after
 * the user had signed in.
 *
 * Wrap the tree once at `main.tsx`; call `useAuthContext()` from
 * anywhere that needs auth state (`App`, `LoginPage`, future
 * `SettingsPage`, etc.).
 */
const AuthContext = createContext<UseAuthResult | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
}

export function useAuthContext(): UseAuthResult {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error(
      'useAuthContext must be used inside <AuthProvider>. ' +
        'Wrap your tree in main.tsx.',
    )
  }
  return ctx
}