import { useEffect, useRef, useState } from 'react'
import { useGameStateContext } from '@/contexts/game-state-context'
import { useDownloadSpeed } from '@/hooks/use-download-speed'
import { formatEta } from '@/lib/format-eta'

const ETA_ALPHA = 0.08 // heavy smoothing — ETAs derived from noisy speeds are jumpy
const ETA_MIN_SPEED_MS = 2000 // require at least 2s of valid speed before showing ETA
// How coarse the displayed bucket is. Below 60s we round to this many
// seconds, so a 5% change in ETA doesn't make the displayed number flicker
// back and forth across a 1-second boundary.
const DISPLAY_GRANULARITY_S = 5

/**
 * Derives a smoothed ETA string from the shared download speed + remaining
 * bytes. Returns:
 *   - the formatted ETA when speed has been valid for ≥ ETA_MIN_SPEED_MS,
 *   - 'Stalled' when the underlying speed hook reports a stall,
 *   - '' (render nothing) when there is no active download or the inputs
 *     needed to compute an ETA are missing.
 *
 * Stability rules:
 *   1. Remaining bytes are clamped to be monotonically non-increasing. If
 *      the backend briefly reports a higher value (e.g. completedBytes
 *      rolled back, totalBytes recomputed), we ignore it. This is the
 *      main source of ETA "spikes".
 *   2. ETA in seconds is EMA-smoothed with a heavy alpha so a single noisy
 *      speed sample can't drag the displayed number around.
 *   3. Display updates are gated on the *formatted* string actually
 *      changing at the coarse bucket granularity, not on the raw seconds.
 *   4. The last valid speed is held across brief null gaps so the ETA
 *      doesn't go blank mid-download.
 */
export function useDownloadEta(): string {
  const { isDownloadingDepot, depotProgress, isUpdating, updateStatus } =
    useGameStateContext()
  const { kind, speed, stalled } = useDownloadSpeed()

  // Remaining bytes for the active branch. This is the *raw* value — the
  // monotonic clamp lives in the effect below.
  const rawRemainingBytes: number | null = (() => {
    if (kind === 'depot' && isDownloadingDepot && depotProgress) {
      const total = depotProgress.totalBytes ?? 0
      const done = depotProgress.completedBytes ?? 0
      if (total > 0) return Math.max(0, total - done)
    } else if (kind === 'update' && isUpdating && updateStatus?.folders) {
      let total = 0
      for (const f of updateStatus.folders) {
        if (f.stage !== 'complete') total += Math.max(0, f.total - f.downloaded)
      }
      return total > 0 ? total : null
    }
    return null
  })()

  const [display, setDisplay] = useState<string>('')

  // Smoothed state in refs.
  const emaEtaRef = useRef<number | null>(null)
  const lastRemainingRef = useRef<number | null>(null)
  const lastValidSpeedRef = useRef<number | null>(null)
  const speedFirstSeenAtRef = useRef<number | null>(null)
  const lastDisplayedRef = useRef<string>('')
  const lastKindRef = useRef<'depot' | 'update' | null>(null)

  useEffect(() => {
    if (lastKindRef.current !== kind) {
      emaEtaRef.current = null
      lastRemainingRef.current = null
      lastValidSpeedRef.current = null
      speedFirstSeenAtRef.current = null
      lastKindRef.current = kind
      lastDisplayedRef.current = ''
      setDisplay('')
    }
  }, [kind])

  useEffect(() => {
    if (stalled) {
      if (lastDisplayedRef.current !== 'Stalled') {
        lastDisplayedRef.current = 'Stalled'
        setDisplay('Stalled')
      }
      return
    }

    if (kind === null) return

    // Hold the last valid speed across brief null gaps so the ETA doesn't
    // go blank. We only commit a new speed sample once we've seen at least
    // one valid one.
    if (speed !== null && speed > 0) {
      lastValidSpeedRef.current = speed
    }
    const effectiveSpeed = lastValidSpeedRef.current
    if (effectiveSpeed === null || effectiveSpeed <= 0) return

    // Clamp remainingBytes to be monotonically non-increasing. If the new
    // value is higher than the previous one, ignore it — that almost
    // always means the backend reported something inconsistent
    // (completedBytes rolled back, totalBytes grew mid-download, etc.).
    let remaining: number | null = null
    if (rawRemainingBytes !== null) {
      if (
        lastRemainingRef.current === null ||
        rawRemainingBytes <= lastRemainingRef.current
      ) {
        remaining = rawRemainingBytes
        lastRemainingRef.current = rawRemainingBytes
      } else {
        remaining = lastRemainingRef.current
      }
    } else {
      remaining = lastRemainingRef.current
    }

    if (remaining === null || remaining <= 0) {
      // Nothing left to download — show empty (the button will switch state
      // on its own).
      return
    }

    const now = performance.now()
    if (speedFirstSeenAtRef.current === null) {
      speedFirstSeenAtRef.current = now
    }
    if (now - speedFirstSeenAtRef.current < ETA_MIN_SPEED_MS) {
      // Not enough signal yet — keep the last displayed value rather than
      // flashing in a wildly different first number.
      return
    }

    const instant = remaining / effectiveSpeed // seconds
    if (!Number.isFinite(instant) || instant < 0) return

    const ema =
      emaEtaRef.current === null
        ? instant
        : ETA_ALPHA * instant + (1 - ETA_ALPHA) * emaEtaRef.current
    emaEtaRef.current = ema

    // Round to the display granularity bucket before comparing, so a small
    // ETA change (say 5m 23s → 5m 22s) doesn't trigger a re-render.
    const bucketed =
      ema < 60
        ? Math.round(ema / DISPLAY_GRANULARITY_S) * DISPLAY_GRANULARITY_S
        : ema
    const text = formatEta(bucketed)
    if (text !== lastDisplayedRef.current) {
      lastDisplayedRef.current = text
      setDisplay(text)
    }
  }, [kind, speed, stalled, rawRemainingBytes])

  return display
}
