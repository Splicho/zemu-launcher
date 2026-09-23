/**
 * Pure decision function backing `useOnboardingGate`.
 *
 * Extracted from the hook so the logic can be unit‑tested without
 * React or `localStorage`, and so the duplicated evaluation paths
 * inside the hook (the `evaluate` callback and the mount‑time
 * effect) stay in lockstep with a single source of truth.
 *
 * Inputs are intentionally already‑resolved — the caller reads the
 * localStorage flag and awaits the IPC round‑trip itself. Keeping
 * this function pure (no I/O, no globals) means the test can
 * exhaustively enumerate every (flag, hasKey, hasFolder, hasBaseGame)
 * combination without mocking.
 *
 * ## Decision rules
 *
 *   1. If `hasKey && hasFolder && hasBaseGame` are all true, the user
 *      has a real install on disk — they're done, regardless of the
 *      localStorage flag. This is the source‑of‑truth branch.
 *
 *   2. Else if the localStorage flag is set and `hasKey && hasFolder`
 *      are true, the user finished the wizard before (the FinishStep
 *      only enables Finish when key + folder + base game are all
 *      true, so a set flag is a strong "they're done" signal). We
 *      still verify key + folder because those are the inputs the
 *      wizard writes directly and a stale flag with a missing key
 *      is more likely a half‑finished wizard than a real install.
 *
 *   3. Otherwise the wizard is incomplete — return the inputs so the
 *      caller can pre‑fill steps the user already has on disk.
 */
import type { SetupChecks } from '@/lib/setup-checks'

export type GateDecision =
  | { kind: 'complete' }
  | { kind: 'incomplete'; inputs: SetupChecks }

export function decideOnboardingGate(
  flag: boolean,
  inputs: SetupChecks,
): GateDecision {
  if (inputs.hasKey && inputs.hasFolder && inputs.hasBaseGame) {
    return { kind: 'complete' }
  }

  if (flag && inputs.hasKey && inputs.hasFolder) {
    return { kind: 'complete' }
  }

  return { kind: 'incomplete', inputs }
}
