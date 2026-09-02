/**
 * License state machine for the launcher.
 *
 * Owns:
 *   - the persisted `LicenseRecord` (loaded from disk on mount,
 *     saved after every successful redeem or revalidate, cleared on logout)
 *   - the redeem action (called by the Properties > License tab)
 *   - periodic revalidation every 60 s while a record is present
 *
 * The hook is the single source of truth for whether the launcher's
 * PC has a bound license. The `GameState` derivation in
 * `useGameState` reads `licenseStatus` from this hook to decide
 * whether to short-circuit to `LICENSE_REQUIRED`.
 *
 * Status mapping:
 *
 *   'unknown'    -- still loading the persisted record from disk.
 *                   Treated as not-bound by the state machine so we
 *                   never accidentally allow a download before we know.
 *   'binding'    -- a redeem/revalidate is in flight.
 *   'bound'      -- record is present and the last validate returned
 *                   `valid: true`.
 *   'unbound'    -- no record, or the last check returned not_found /
 *                   revoked. The "License required" state.
 *   'other-pc'   -- last validate returned `already_bound`. The key
 *                   exists but isn't ours; downloads are gated behind
 *                   LICENSE_REQUIRED with a different modal message.
 *
 * Persistence:
 *
 *   The license record is stored at `app_data/license-store.json` by
 *   the Rust side. We load it on mount and save after every successful
 *   redeem and every successful revalidate.
 *
 *   The `discord_user_id` field is only ever read from the server
 *   response; it is NOT used as a gating mechanism any more — the
 *   server stopped returning `discord_required` for redeem.
 */
import { createContext, useContext, useEffect, useState } from 'react'
import { validateLicense, redeemLicense, logLicenseDebug } from '@/lib/license'
import type {
  ValidateFailureReason,
  RedeemFailureReason,
} from '@/lib/license'

export type LicenseStatus =
  | 'unknown'
  | 'binding'
  | 'bound'
  | 'unbound'
  | 'other-pc'

export interface LicenseRecord {
  licenseKey: string
  pcIdentifier: string
  boundAt: number
  validatedAt: number
  discordUserId: string | null
}

export type LicenseFailureReason =
  | ValidateFailureReason
  | RedeemFailureReason
  | 'unreachable'

/** Alias for the failure discriminated-union returned by redeem/revalidate. */
export type LicenseFailure = LicenseFailureReason

export interface UseLicenseResult {
  status: LicenseStatus
  record: LicenseRecord | null
  redeemError: LicenseFailureReason | null
  revalidateError: LicenseFailureReason | null
  redeem: (
    rawKey: string
  ) => Promise<{ ok: true } | { ok: false; failure: LicenseFailure }>
  revalidate: () => Promise<
    { ok: true } | { ok: false; failure: LicenseFailure }
  >
  reset: () => Promise<void>
}

export interface UseLicenseOptions {
  /**
   * If false, the license check is skipped. Used by the auth flow so
   * we don't fire license calls before the user is signed in.
   * Default: true.
   */
  enabled?: boolean
}

const REVALIDATE_INTERVAL_MS = 60_000

export function useLicense({
  enabled = true,
}: UseLicenseOptions = {}): UseLicenseResult {
  const [status, setStatus] = useState<LicenseStatus>('unknown')
  const [record, setRecord] = useState<LicenseRecord | null>(null)
  const [redeemError, setRedeemError] = useState<LicenseFailureReason | null>(
    null
  )
  const [revalidateError, setRevalidateError] =
    useState<LicenseFailureReason | null>(null)

  // Resolve the PC identifier once. Cheap IPC; we just await it when
  // we need it the first time. We keep it in state (not a ref) so it
  // survives across renders and we only resolve it once.
  const [pcIdentifier, setPcIdentifier] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled) return
    if (typeof window === 'undefined' || !window.gameAPI?.getPcIdentifier) {
      setPcIdentifier('dev-pc-identifier')
      return
    }
    let cancelled = false
    window.gameAPI
      .getPcIdentifier()
      .then((id) => {
        if (!cancelled) setPcIdentifier(id)
      })
      .catch((error) => {
        logLicenseDebug(`getPcIdentifier failed: ${String(error)}`)
        console.warn('[license] getPcIdentifier failed', error)
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  async function revalidate(): Promise<
    { ok: true } | { ok: false; failure: LicenseFailure }
  > {
    if (!enabled || !record) {
      return { ok: false, failure: 'unreachable' }
    }
    if (!pcIdentifier) {
      return { ok: false, failure: 'unreachable' }
    }

    setStatus('binding')
    const result = await validateWithKey(record.licenseKey, pcIdentifier)
    applyValidationResult(result)
    return result.ok ? { ok: true } : { ok: false, failure: result.reason }
  }

  async function redeem(
    rawKey: string
  ): Promise<{ ok: true } | { ok: false; failure: LicenseFailure }> {
    setRedeemError(null)
    if (!pcIdentifier) {
      logLicenseDebug('redeem aborted: pcIdentifier is not available')
      const failure: LicenseFailure = 'unreachable'
      setRedeemError(failure)
      setStatus('unbound')
      return { ok: false, failure }
    }
    setStatus('binding')
    const outcome = await redeemLicense({
      licenseKey: rawKey,
      pcIdentifier,
    })
    if (outcome.kind === 'ok') {
      const next: LicenseRecord = {
        licenseKey: outcome.response.licenseKey,
        pcIdentifier,
        boundAt: Date.now(),
        validatedAt: Date.now(),
        discordUserId: outcome.response.discordUserId,
      }
      await saveRecord(next)
      setRecord(next)
      setStatus('bound')
      setRedeemError(null)
      return { ok: true }
    }
    if (outcome.kind === 'denied') {
      const failure: LicenseFailure = outcome.response.reason
      setRedeemError(failure)
      setStatus(
        outcome.response.reason === 'already_bound' ? 'other-pc' : 'unbound'
      )
      return { ok: false, failure }
    }
    const failure: LicenseFailure = 'unreachable'
    setRedeemError(failure)
    setStatus('unbound')
    return { ok: false, failure }
  }

  async function reset(): Promise<void> {
    setStatus('unbound')
    setRecord(null)
    setRedeemError(null)
    setRevalidateError(null)
    await clearRecord()
  }

  // Single shared helper: validate `key` against the server and roll
  // the outcome into `status` + `record` + `revalidateError`. Used by
  // both the mount flow and the periodic interval.
  async function validateWithKey(
    key: string,
    pc: string
  ): Promise<
    | { ok: true; record: LicenseRecord }
    | { ok: false; reason: LicenseFailureReason }
  > {
    const outcome = await validateLicense({
      licenseKey: key,
      pcIdentifier: pc,
    })
    if (outcome.kind === 'ok') {
      const next: LicenseRecord = {
        licenseKey: outcome.response.licenseKey,
        pcIdentifier: pc,
        boundAt: record?.boundAt ?? Date.now(),
        validatedAt: Date.now(),
        discordUserId: outcome.response.discordUserId,
      }
      await saveRecord(next)
      return { ok: true, record: next }
    }
    if (outcome.kind === 'denied') {
      return { ok: false, reason: outcome.response.reason }
    }
    return { ok: false, reason: 'unreachable' }
  }

  function applyValidationResult(
    result:
      | { ok: true; record: LicenseRecord }
      | { ok: false; reason: LicenseFailureReason }
  ): void {
    if (result.ok) {
      setRecord(result.record)
      setStatus('bound')
      setRevalidateError(null)
      return
    }
    if (result.reason === 'already_bound') {
      setStatus('other-pc')
      setRevalidateError(result.reason)
      return
    }
    if (result.reason === 'unreachable') {
      // Server unreachable — keep the cached record. We'll retry in
      // 60s; bouncing the user into "Account Key Required" for a
      // transient network blip is exactly what we don't want.
      setStatus('bound')
      setRevalidateError(result.reason)
      return
    }
    // not_found / revoked: the server has definitively rejected this
    // key. The record on disk is now stale — an admin may have
    // revoked the key, or a stray row may have been deleted out from
    // under us. Clearing `record` (and the persisted
    // `license-store.json`) makes the table render its empty-state
    // row instead of a ghost key wearing an "Active" badge, and
    // prevents the periodic revalidate from re-checking a key that
    // will never come back. The "License required" gate already
    // opened via `setStatus('unbound')` below; this just keeps the
    // cached display in sync with the authoritative server answer.
    void clearRecord()
    setRecord(null)
    setStatus('unbound')
    setRevalidateError(result.reason)
  }

  // Load on mount. If a record is on disk, restore it as `bound`
  // immediately (so the UI doesn't flash "Account Key Required")
  // and validate in the background to confirm the server still
  // agrees. The periodic interval below keeps the record fresh.
  useEffect(() => {
    if (!enabled) {
      setStatus('unbound')
      return
    }
    let cancelled = false
    ;(async () => {
      const stored = await loadRecord()
      if (cancelled) return
      if (!stored) {
        setStatus('unbound')
        return
      }
      setRecord(stored)
      setStatus('bound')
      setRevalidateError(null)
    })()
    return () => {
      cancelled = true
    }
  }, [enabled])

  // Re-validate in the background once we have both the cached
  // record and the PC identifier. Re-runs when either changes so a
  // late-arriving PC id doesn't strand the cached record on "bound"
  // forever — we always want to confirm the server still agrees.
  //
  // IMPORTANT: depend on the stable *fields* of `record`, not on
  // the record object itself. `applyValidationResult` builds a
  // fresh `LicenseRecord` on every successful validate and calls
  // `setRecord(newObj)` — so depending on `record` by reference
  // would treat every successful validate as a "change", the effect
  // would re-fire, and we'd loop validate→setRecord→validate at
  // ~1 round-trip per render (≈tens of requests per second, see the
  // backend logs). Depending on `record.licenseKey` keeps the effect
  // locked to the actual key the user is bound to — it re-fires
  // only when a different key shows up (redeem, sign-in rebind,
  // logout→signin clearing the cache).
  useEffect(() => {
    if (!enabled || !record || !pcIdentifier) return
    let cancelled = false
    ;(async () => {
      const result = await validateWithKey(record.licenseKey, pcIdentifier)
      if (cancelled) return
      applyValidationResult(result)
    })()
    return () => {
      cancelled = true
    }
    // We intentionally re-run only when the *identity* of the bound
    // key changes — not on every render, and not when validate()
    // produces a fresh record reference. Periodic refresh below
    // handles the steady-state cadence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, record?.licenseKey, pcIdentifier])

  // Periodic revalidation. Cleans itself up on unmount and on
  // sign-out (`enabled` flips false). Only ticks while a record
  // exists — no point pinging the server for an unbound launcher.
  //
  // Same dep-stability caveat as the effect above: depend on the
  // key, not on the record object, so a successful validate doesn't
  // reset the 60-second timer back to zero on every tick.
  useEffect(() => {
    if (!enabled || !record || !pcIdentifier) return
    const interval = setInterval(() => {
      void revalidate()
    }, REVALIDATE_INTERVAL_MS)
    return () => clearInterval(interval)
    // Re-arm only when the bound key (or pc id) changes. `revalidate`
    // reads the current record/identifier through closure; the next
    // tick (within 60s) will pick up any new values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, record?.licenseKey, pcIdentifier])

  return {
    status,
    record,
    redeemError,
    revalidateError,
    redeem,
    revalidate,
    reset,
  }
}

// ── IPC helpers ─────────────────────────────────────────────────────────
//
// These exist so React doesn't track them as state and so the
// `window.licenseAPI?.…` null checks stay in one place.

async function loadRecord(): Promise<LicenseRecord | null> {
  if (typeof window === 'undefined' || !window.licenseAPI?.getRecord) {
    return null
  }
  try {
    const stored = await window.licenseAPI.getRecord()
    return stored ?? null
  } catch (error) {
    console.warn('[license] failed to load record from disk', error)
    return null
  }
}

async function saveRecord(record: LicenseRecord): Promise<void> {
  if (typeof window === 'undefined' || !window.licenseAPI?.saveRecord) return
  try {
    await window.licenseAPI.saveRecord(record)
  } catch (error) {
    console.warn('[license] failed to save record to disk', error)
  }
}

async function clearRecord(): Promise<void> {
  if (typeof window === 'undefined' || !window.licenseAPI?.clearRecord) return
  try {
    await window.licenseAPI.clearRecord()
  } catch (error) {
    console.warn('[license] failed to clear record from disk', error)
  }
}

// ── Context ─────────────────────────────────────────────────────────────
//
// Shared instance of `useLicense()` for the whole tree. The consumer
// hook + context object live in this hook file (not in the `.tsx`
// provider file) so Vite's React Fast Refresh can hot-reload the
// `<LicenseProvider>` component without tripping the
// "non-component export in a component file" guard. Hooks go in
// `.ts`, components go in `.tsx`.

export const LicenseContext = createContext<UseLicenseResult | null>(null)

export function useLicenseContext(): UseLicenseResult {
  const ctx = useContext(LicenseContext)
  if (!ctx) {
    throw new Error(
      'useLicenseContext must be used inside <LicenseProvider>. ' +
        'Wrap your tree in main-app.tsx.'
    )
  }
  return ctx
}
