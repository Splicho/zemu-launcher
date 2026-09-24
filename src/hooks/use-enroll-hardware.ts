/**
 * Hardware-identity enrollment — fires once after the user resolves
 * to `'authed'`, on a short idle delay so the auth context has fully
 * settled. The Tauri command does the actual lift (TPM ladder +
 * OS-UUID fallback + API POST); this hook just enqueues the call and
 * silently swallows failures.
 *
 * ## Why a hook and not a top-level effect in main-app.tsx
 *
 * Mounting this in main-app.tsx would couple the enrollment to the
 * whole renderer being mounted; we want it tied to the *authed*
 * state, not to the renderer's existence. Putting it in useAuth lets
 * the auth state machine own the lifecycle — when the user signs out
 * the next sign-in re-arms enrollment automatically.
 *
 * ## Why "after login, on idle"
 *
 *   - The launcher's auth state machine resolves to `'authed'` after
 *     a network round-trip + token introspect, which can take a few
 *     hundred ms. The first-tick enrollment would race with the
 *     introspect and the badge the user actually cares about.
 *   - Enrollment is fire-and-forget. A failed enrollment never blocks
 *     sign-in. Missing the row means the api's `assertHardwareNotBanned`
 *     gate is a no-op (best-effort per the plan). The cost of waiting
 *     is just one fewer enrollment call against the api.
 *   - The `idle` here is a fixed 3 s delay, not `requestIdleCallback` —
 *     the latter doesn't fire on Tauri's webview reliably, and a
 *     fixed delay is easier to reason about across all three
 *     platforms.
 *
 * ## Failure posture
 *
 * Every failure mode is swallowed (logged + dropped):
 *
 *   - Tauri command throws (no bridge available)
 *   - `enroll_hardware` returns `Ok(None)` (no anchor, no row)
 *   - `enroll_hardware` returns `Err(...)` (caller-side error)
 *
 * None of those should surface in the UI. The launcher's auth flow
 * succeeds regardless.
 */

import { useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'

import type { AuthStatus } from '@/hooks/use-auth'

/**
 * Idle delay in ms. Long enough that the auth context has fully
 * resolved (introspect round-trip + token persist); short enough
 * that the row exists before the user can plausibly sign out
 * again on a slow machine.
 */
const ENROLLMENT_IDLE_DELAY_MS = 3_000

/**
 * Wire shape returned from the `enroll_hardware` Tauri command.
 * `kind` is the api's recognised anchor name; `hash` is reserved
 * for a future "my devices" surface (the api re-keys server-side,
 * so the launcher never sees the rehashed value).
 */
type EnrolledAnchor = {
  kind: string
  hash: string
} | null

/**
 * Mount inside the auth context. The hook is a no-op until the user
 * resolves to `'authed'` — sign-in / sign-out transitions re-arm
 * the enrollment timer.
 *
 * @param status - the auth state machine's `status` value (the
 *   `'authed' | 'loading' | 'auth' | 'exchanging'` discriminated
 *   union from `useAuth`).
 */
export function useEnrollHardware(status: AuthStatus) {
  useEffect(() => {
    if (status !== 'authed') return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    // Idle delay so we don't race the introspect round-trip. A user
    // who's signing in shouldn't see a wasted enrollment POST before
    // the auth state has actually settled on `'authed'`.
    timer = setTimeout(() => {
      void (async () => {
        if (cancelled) return
        try {
          const result = await invoke<EnrolledAnchor>('enroll_hardware')
          if (cancelled) return
          if (result?.kind) {
            // Surface for the debug log only — the launcher's normal
            // auth flow doesn't show the enrolled kind anywhere.
            // A future "my devices" panel in the account dropdown
            // would read this via `GET /v1/hardware/list` instead.
            console.debug(`[hardware] enrolled kind=${result.kind}`)
          }
        } catch {
          // Best-effort. Failures are swallowed (logged via the
          // Tauri debug log on the Rust side). The user never sees
          // a banner for a missing hardware row.
        }
      })()
    }, ENROLLMENT_IDLE_DELAY_MS)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [status])
}
