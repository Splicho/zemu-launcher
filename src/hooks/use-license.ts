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
 * Status mapping (internal -> exposed):
 *
 *   'unknown'    -- still loading the persisted record from disk.
 *                   Treated as not-bound by the state machine so we
 *                   never accidentally allow a download before we know.
 *   'binding'    -- a redeem/revalidate is in flight.
 *   'bound'      -- record is present and the last validate returned
 *                   `valid: true`.
 *   'unbound'    -- no record, or the last check returned not_found /
 *                   revoked / unreachable with no cached record. The
 *                   "License required" state.
 *   'other-pc'   -- last validate returned `already_bound`. The key
 *                   exists but isn't ours; downloads are gated behind
 *                   LICENSE_REQUIRED with a different modal message.
 *
 * Persistence model:
 *
 *   The license record is stored at `app_data/license-store.json` by
 *   the Rust side. Loading it on mount means the launcher survives
 *   restarts without re-pasting the key. Saving after every redeem
 *   and every successful revalidate keeps the file current.
 *
 *   The `discord_user_id` field is only ever read from the server
 *   response; it is NOT used as a gating mechanism any more — the
 *   server stopped returning `discord_required` for redeem.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { validateLicense, redeemLicense, type ValidateFailureReason, type RedeemFailureReason } from '@/lib/license'

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

/**
 * Failures from either the redeem (user-paste) or revalidate (cached
 * check) flows. The redeem set is now the same as the validate set
 * (the server no longer returns `discord_required`); we still type
 * both flows through the same union so the UI error map stays in one
 * place.
 */
export interface LicenseFailure {
  reason: ValidateFailureReason | RedeemFailureReason | 'unreachable'
}

export interface UseLicenseResult {
  status: LicenseStatus
  record: LicenseRecord | null
  /**
   * Last redeem attempt's failure — `null` while no attempt is in
   * flight or the last attempt succeeded.
   */
  redeemError: LicenseFailure | null
  /**
   * Whether the last revalidate ended in a failure — distinct from
   * `redeemError` (which is only set by explicit user action).
   * Lets the modal show "couldn't reach the license server" without
   * it being mistaken for a redemption attempt.
   */
  revalidateError: LicenseFailure | null
  /**
   * Try to redeem a user-pasted key. On success the record is saved
   * to disk. On failure the error is returned so the UI can render it.
   */
  redeem: (rawKey: string) => Promise<{ ok: true } | { ok: false; failure: LicenseFailure }>
  /**
   * Re-run validate against the currently-cached record. Saves the
   * updated record (with fresh `validatedAt`) to disk on success.
   */
  revalidate: () => Promise<LicenseStatus>
  /**
   * Drop everything — used on logout. Clears both in-memory state and
   * the persisted record on disk.
   */
  reset: () => void
}

export interface UseLicenseOptions {
  /**
   * If false, the license check is skipped. Used by the auth flow so
   * we don't fire license calls before the user is signed in.
   * Default: true.
   */
  enabled?: boolean
}

/** Revalidation interval in milliseconds (60 seconds). */
const REVALIDATE_INTERVAL_MS = 60_000

export function useLicense(options: UseLicenseOptions = {}): UseLicenseResult {
  const enabled = options.enabled ?? true

  const [status, setStatus] = useState<LicenseStatus>('unknown')
  const [record, setRecord] = useState<LicenseRecord | null>(null)
  const [redeemError, setRedeemError] = useState<LicenseFailure | null>(null)
  const [revalidateError, setRevalidateError] = useState<LicenseFailure | null>(null)

  const pcIdentifierRef = useRef<string | null>(null)
  const revalidateIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isMountedRef = useRef(true)

  // ── Disk persistence helpers ──────────────────────────────────────────────

  const loadFromDisk = useCallback(async (): Promise<LicenseRecord | null> => {
    if (typeof window === 'undefined' || !window.licenseAPI?.getRecord) {
      return null
    }
    try {
      const stored = await window.licenseAPI.getRecord()
      return stored ?? null
    } catch {
      return null
    }
  }, [])

  const saveToDisk = useCallback(async (r: LicenseRecord): Promise<void> => {
    if (typeof window === 'undefined' || !window.licenseAPI?.saveRecord) return
    try {
      await window.licenseAPI.saveRecord(r)
    } catch (error) {
      console.warn('[license] failed to save record to disk', error)
    }
  }, [])

  const clearFromDisk = useCallback(async (): Promise<void> => {
    if (typeof window === 'undefined' || !window.licenseAPI?.clearRecord) return
    try {
      await window.licenseAPI.clearRecord()
    } catch (error) {
      console.warn('[license] failed to clear record from disk', error)
    }
  }, [])

  // ── Resolve PC identifier once ─────────────────────────────────────────────

  useEffect(() => {
    if (!enabled) return
    if (typeof window === 'undefined' || !window.gameAPI?.getPcIdentifier) {
      pcIdentifierRef.current = 'dev-pc-identifier'
      return
    }
    let cancelled = false
    window.gameAPI
      .getPcIdentifier()
      .then((id) => {
        if (!cancelled) pcIdentifierRef.current = id
      })
      .catch((error: unknown) => {
        console.warn('[license] getPcIdentifier failed', error)
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  // ── Core validate logic ───────────────────────────────────────────────────

  /**
   * Run a single validate call. On success, updates `validatedAt` and
   * saves the record to disk. Returns the record so callers can update
   * their own state if needed.
   */
  const runValidate = useCallback(
    async (
      rawKey: string,
      currentRecord: LicenseRecord | null,
    ): Promise<
      | { ok: true; record: LicenseRecord }
      | { ok: false; failure: LicenseFailure }
    > => {
      const pcIdentifier = pcIdentifierRef.current
      if (!pcIdentifier) {
        return { ok: false, failure: { reason: 'unreachable' } }
      }
      const outcome = await validateLicense({ licenseKey: rawKey, pcIdentifier })
      if (outcome.kind === 'ok') {
        const now = Date.now()
        const next: LicenseRecord = {
          licenseKey: outcome.response.licenseKey,
          pcIdentifier,
          // Preserve the original `boundAt` so the card shows when the
          // key was first bound, not when it was last checked.
          boundAt: currentRecord?.boundAt ?? now,
          validatedAt: now,
          discordUserId: outcome.response.discordUserId,
        }
        await saveToDisk(next)
        return { ok: true, record: next }
      }
      if (outcome.kind === 'denied') {
        return { ok: false, failure: { reason: outcome.response.reason } }
      }
      return { ok: false, failure: { reason: 'unreachable' } }
    },
    [saveToDisk],
  )

  // ── Revalidate ────────────────────────────────────────────────────────────

  const revalidate = useCallback(async (): Promise<LicenseStatus> => {
    if (!enabled) return 'unbound'
    const cachedKey = record?.licenseKey
    if (!cachedKey) {
      setStatus((prev) => (prev === 'unknown' ? prev : 'unbound'))
      setRevalidateError(null)
      return 'unbound'
    }
    setStatus('binding')
    const result = await runValidate(cachedKey, record)
    if (result.ok) {
      setRecord(result.record)
      setStatus('bound')
      setRevalidateError(null)
      return 'bound'
    }
    if (result.failure.reason === 'already_bound') {
      // Cached locally but the server says it's bound to a different PC.
      // Keep the record so the user can see what happened, but gate
      // downloads.
      setStatus('other-pc')
      setRevalidateError(result.failure)
      return 'other-pc'
    }
    if (result.failure.reason === 'unreachable') {
      // Can't reach the server — keep using the cached record so the
      // user isn't cut off mid-session. Surface the error non-destructively.
      setStatus(record ? 'bound' : 'unbound')
      setRevalidateError(result.failure)
      return record ? 'bound' : 'unbound'
    }
    // not_found / revoked: the key is no longer valid. Drop it.
    await clearFromDisk()
    setRecord(null)
    setStatus('unbound')
    setRevalidateError(result.failure)
    return 'unbound'
  }, [enabled, record, runValidate, clearFromDisk])

  // ── Mount: load from disk, then revalidate if present ────────────────────

  useEffect(() => {
    if (!enabled) {
      setStatus('unbound')
      return
    }
    isMountedRef.current = true
    let cancelled = false

    ;(async () => {
      const stored = await loadFromDisk()
      if (cancelled || !isMountedRef.current) return

      if (!stored) {
        setStatus('unbound')
        setRevalidateError(null)
        return
      }

      // Restore the record immediately so the UI doesn't flash "no license"
      // before the revalidate completes.
      setRecord(stored)
      setStatus('bound')
      setRevalidateError(null)

      // But revalidate in the background to confirm it's still valid.
      const result = await runValidate(stored.licenseKey, stored)
      if (cancelled || !isMountedRef.current) return

      if (result.ok) {
        setRecord(result.record)
        setStatus('bound')
        setRevalidateError(null)
      } else if (result.failure.reason === 'already_bound') {
        setStatus('other-pc')
        setRevalidateError(result.failure)
      } else if (result.failure.reason === 'unreachable') {
        // Server is unreachable — keep using the cached record.
        setStatus('bound')
        setRevalidateError(result.failure)
      } else {
        // not_found / revoked — drop it.
        await clearFromDisk()
        setRecord(null)
        setStatus('unbound')
        setRevalidateError(result.failure)
      }
    })()

    return () => {
      cancelled = true
      isMountedRef.current = false
    }
  }, [enabled, loadFromDisk, runValidate, clearFromDisk])

  // ── Periodic revalidation interval ────────────────────────────────────────

  useEffect(() => {
    if (!enabled) return

    const tick = () => {
      if (record) void revalidate()
    }

    revalidateIntervalRef.current = setInterval(tick, REVALIDATE_INTERVAL_MS)
    return () => {
      if (revalidateIntervalRef.current !== null) {
        clearInterval(revalidateIntervalRef.current)
        revalidateIntervalRef.current = null
      }
    }
  }, [enabled, record, revalidate])

  // ── Redeem ────────────────────────────────────────────────────────────────

  const redeem = useCallback(
    async (
      rawKey: string,
    ): Promise<{ ok: true } | { ok: false; failure: LicenseFailure }> => {
      setRedeemError(null)
      setStatus('binding')
      const pcIdentifier = pcIdentifierRef.current
      if (!pcIdentifier) {
        const failure: LicenseFailure = { reason: 'unreachable' }
        setRedeemError(failure)
        setStatus('unbound')
        return { ok: false, failure }
      }
      const outcome = await redeemLicense({
        licenseKey: rawKey,
        pcIdentifier,
      })
      if (outcome.kind === 'ok') {
        const now = Date.now()
        const next: LicenseRecord = {
          licenseKey: outcome.response.licenseKey,
          pcIdentifier,
          boundAt: now,
          validatedAt: now,
          discordUserId: outcome.response.discordUserId,
        }
        await saveToDisk(next)
        setRecord(next)
        setStatus('bound')
        setRedeemError(null)
        return { ok: true }
      }
      if (outcome.kind === 'denied') {
        const failure: LicenseFailure = { reason: outcome.response.reason }
        setRedeemError(failure)
        setStatus(
          outcome.response.reason === 'already_bound' ? 'other-pc' : 'unbound',
        )
        return { ok: false, failure }
      }
      const failure: LicenseFailure = { reason: 'unreachable' }
      setRedeemError(failure)
      setStatus('unbound')
      return { ok: false, failure }
    },
    [saveToDisk],
  )

  // ── Reset ─────────────────────────────────────────────────────────────────

  const reset = useCallback(async () => {
    setStatus('unbound')
    setRecord(null)
    setRedeemError(null)
    setRevalidateError(null)
    await clearFromDisk()
  }, [clearFromDisk])

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
