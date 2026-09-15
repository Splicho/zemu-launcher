import { useCallback, useEffect, useState } from 'react'

import { getSetupChecks, type SetupChecks } from '@/lib/setup-checks'
import { hasCompletedOnboarding } from '@/lib/onboarding'

/**
 * Single source of truth for "should the user be in /onboarding right
 * now?". The wizard consumes this via the `AuthedApp` redirect effect.
 *
 * State machine:
 *
 *   - `loading`      — initial mount, the IPC round-trip to read the
 *                      auth key + folder + base game is in flight.
 *                      Callers should treat this as "wait".
 *   - `complete`     — the user has already finished the wizard (the
 *                      localStorage flag is set) OR the on-disk
 *                      `SetupChecks` show key + folder + base game all
 *                      present. Either way, send them to `/`.
 *   - `incomplete`   — at least one input is missing. `inputs` carries
 *                      what we already know so the wizard can pre-fill
 *                      and skip steps the user has already done.
 *
 * Returning users who wiped their localStorage but still have a valid
 * install on disk fall through to `complete` via the on-disk checks —
 * this is the "edge case" the plan flagged: don't force a returning
 * user through the wizard again just because their browser state
 * cleared.
 *
 * ## Refresh contract
 *
 * The wizard's `Finish` button flips the localStorage flag. Without a
 * re-evaluation the redirect effect still sees `incomplete` and pushes
 * the user back into the wizard. `refresh()` re-runs the gate logic on
 * demand. It is exported via the hook's return value so the wizard can
 * call it from its `finish` callback after `markOnboardingCompleted()`
 * and before the hash flip.
 *
 * Trusting the flag: if the user just clicked Finish they have already
 * walked through the four-item checklist in `FinishStep` (key + folder
 * + base game + patch). We don't revalidate every check on disk before
 * letting them out — that would re-block them if, say, the keyring's
 * `getAuthKey` returned a transient error. The `Finish` click is the
 * strongest signal we have; disk re-validation only gates the
 * "returning user who never set the flag" path.
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
    const flag = hasCompletedOnboarding()
    const inputs = await getSetupChecks()

    // Path 1 — returning user with a wiped flag: if everything is on
    // disk we skip the wizard regardless of the flag.
    if (!flag && inputs.hasKey && inputs.hasFolder && inputs.hasBaseGame) {
      setState({ kind: 'complete' })
      return
    }

    // Path 2 — user has either just completed the wizard OR is a
    // returning user with the flag set. The wizard's FinishStep only
    // enables Finish when key + folder + base game are all true, so a
    // set flag is a strong "they're done" signal. We still verify
    // hasKey + hasFolder because those are the inputs the wizard
    // writes directly (no on-disk presence required for the flag to
    //         be authoritative on its own).
    if (flag && inputs.hasKey && inputs.hasFolder) {
      setState({ kind: 'complete' })
      return
    }

    setState({ kind: 'incomplete', inputs })
  }, [])

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      const flag = hasCompletedOnboarding()
      const inputs = await getSetupChecks()
      if (cancelled) return

      if (!flag && inputs.hasKey && inputs.hasFolder && inputs.hasBaseGame) {
        setState({ kind: 'complete' })
        return
      }
      if (flag && inputs.hasKey && inputs.hasFolder) {
        setState({ kind: 'complete' })
        return
      }

      setState({ kind: 'incomplete', inputs })
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
