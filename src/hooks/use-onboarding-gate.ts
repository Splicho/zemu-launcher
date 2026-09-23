import { useCallback, useEffect, useState } from 'react'

import { getSetupChecks, type SetupChecks } from '@/lib/setup-checks'
import { hasCompletedOnboarding } from '@/lib/onboarding'
import { decideOnboardingGate } from '@/lib/onboarding-gate'

/**
 * Single source of truth for "should the user be in /onboarding right
 * now?". The wizard and the install-check pre-screen both consume this
 * via the `AuthedApp` redirect effect.
 *
 * State machine:
 *
 *   - `loading`      — initial mount, the IPC round-trip to read the
 *                      auth key + folder + base game is in flight.
 *                      Callers should treat this as "wait".
 *   - `complete`     — the user has a real install on disk
 *                      (key + folder + base game) OR has previously
 *                      finished the wizard (flag + key + folder).
 *                      Either way, send them to `/`.
    20| *   - `incomplete`   — at least one input is missing. `inputs` carries
 *                      what we already know so the wizard can pre-fill
 *                      and skip steps the user has already done.
 *
 * The decision rules live in `decideOnboardingGate` and are
 * unit‑tested in `scripts/onboarding-gate.test.cjs`. The hook itself
 * is a thin wrapper that resolves the flag (now an async IPC read
 * against `LauncherConfig.onboarding_completed` on the Rust side —
 * see `src/lib/onboarding.ts` for the rationale) and inputs, calls
 * the pure decision, and exposes a `refresh()` for the wizard /
 * install-check to invoke after flipping the flag.
 *
 * Returning users who wiped their localStorage but still have a valid
 * install on disk fall through to `complete` via the on-disk checks.
 * Before the flag moved to Rust, a wiped localStorage flag used to
 * send these users through the wizard again; that's now solved at the
 * source by persisting the flag in `launcher-config.json` where it
 * survives browser-data clears.
 *
 * ## Refresh contract
 *
 * The wizard's `Finish` button (and the install-check's "Yes, I do"
 * button) flip the persisted flag. Without a re-evaluation the
 * redirect effect still sees `incomplete` and pushes the user back
 * into the install-check. `refresh()` re-runs the gate logic on
 * demand. It is exported via the hook's return value so the wizard
 * can call it from its `finish` callback after
 * `markOnboardingCompleted()` resolves and before the hash flip.
 *
 * Trusting the flag: if the user just clicked Finish they have
 * already walked through the four-item checklist in `FinishStep`
 * (key + folder + base game + patch). We don't revalidate every
 * check on disk before letting them out — that would re-block them
 * if, say, the keyring's `getAuthKey` returned a transient error.
 * The `Finish` click is the strongest signal we have; disk
 * re-validation only gates the "returning user who never set the
 * flag" path.
 */

export type GateState =
  | { kind: 'loading' }
  | { kind: 'complete' }
  | { kind: 'incomplete'; inputs: SetupChecks }

export function useOnboardingGate(): {
  state: GateState
  refresh: () => Promise<void>
} {
  const [state, setState] = useState<GateState>({ kind: 'loading' })
  // Bumped by `refresh()` to force re-evaluation on demand. We can't
  // just re-call `evaluate` from React state because that would race
  // with the mount-time effect.
  const [refreshTick, setRefreshTick] = useState(0)

  const evaluate = useCallback(async () => {
    // `hasCompletedOnboarding` is now an async IPC call to the Rust
    // side (`launcher_get_onboarding_completed`). It resolves to
    // `false` on a missing Tauri runtime, which is the right answer
    // for dev mode — the install-check / wizard mounts in that case,
    // matching the pre-existing behavior.
    const [flag, inputs] = await Promise.all([
      hasCompletedOnboarding(),
      getSetupChecks(),
    ])
    setState(decideOnboardingGate(flag, inputs))
  }, [])

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      const [flag, inputs] = await Promise.all([
        hasCompletedOnboarding(),
        getSetupChecks(),
      ])
      if (cancelled) return
      setState(decideOnboardingGate(flag, inputs))
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [refreshTick])

  const refresh = useCallback(async () => {
    await evaluate()
    setRefreshTick((t) => t + 1)
  }, [evaluate])

  return { state, refresh }
}
