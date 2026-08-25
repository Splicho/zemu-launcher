import { useEffect, useRef, useState } from 'react'
import { useGameStateContext } from '@/contexts/game-state-context'
import type { UpdateProgressFile } from '@/lib/tauri-bridge'

const STALL_TIMEOUT_MS = 3000
// Smoothing constants. Two layers:
//   1. SAMPLE_MIN_INTERVAL_MS: ignore samples arriving faster than this (the
//      underlying stream emits a `chunk_progress` per chunk flushed, which
//      can fire faster than the display can update and produces small `dt`
//      values that inflate the instantaneous rate — that's what was making
//      the speed briefly spike to 100 MBit/s on a 50 MBit/s link).
//   2. EMA_ALPHA: smooth the windowed rate (not the per-event instant).
//      Lower = steadier but slower to react to real changes.
const SAMPLE_MIN_INTERVAL_MS = 250
const RATE_WINDOW_MS = 1000
const EMA_ALPHA = 0.35
// Only re-flush React state when the *displayed* values change. The raw EMA
// keeps running on every sample; this just gates React work.
const TOAST_UPDATE_INTERVAL_MS = 150

export type DownloadKind = 'depot' | 'update'

export interface DownloadSpeed {
  kind: DownloadKind | null
  speed: number | null
  stalled: boolean
}

/**
 * Shared speed derivation for both the depot and patch flows.
 *
 * Depot branch:
 *   - Accumulate bytes between samples (so the rate reflects the last
 *     RATE_WINDOW_MS of traffic, not one chunk flushed 2ms apart from the
 *     previous one).
 *   - Emit one rate sample every RATE_WINDOW_MS (subject to a
 *     SAMPLE_MIN_INTERVAL_MS floor), then EMA-smooth it.
 *
 * Patch branch:
 *   - The Rust side already reports per-file `speed`, but those are noisy
 *     instantaneous values. Sum them and EMA-smooth the sum.
 *
 * Returns the smoothed speed + a stall flag, plus which branch is active so
 * consumers (toast, ETA, button label) can switch behaviour.
 */
export function useDownloadSpeed(): DownloadSpeed {
  const { isDownloadingDepot, depotProgress, isUpdating, updateStatus } =
    useGameStateContext()

  const showForDepot =
    isDownloadingDepot &&
    depotProgress !== null &&
    (depotProgress.phase === 'chunk_progress' ||
      depotProgress.phase === 'file_started' ||
      depotProgress.phase === 'file_completed')

  const showForUpdate =
    isUpdating && updateStatus !== null && updateStatus.isUpdating
  const kind: DownloadKind | null = showForDepot
    ? 'depot'
    : showForUpdate
      ? 'update'
      : null

  const [state, setState] = useState<DownloadSpeed>({
    kind: null,
    speed: null,
    stalled: false,
  })

  // ── Depot refs ────────────────────────────────────────────────────────────
  const lastSampleAtRef = useRef<number | null>(null)
  const lastBytesRef = useRef<number | null>(null)
  const windowBytesRef = useRef<number>(0)
  const windowStartAtRef = useRef<number | null>(null)
  const emaSpeedRef = useRef<number | null>(null)
  const displayedSpeedRef = useRef<number | null>(null)
  const lastFlushAtRef = useRef<number>(0)

  // ── Patch refs ────────────────────────────────────────────────────────────
  const patchEmaRef = useRef<number | null>(null)
  const patchDisplayedSpeedRef = useRef<number | null>(null)
  const lastPatchFlushAtRef = useRef<number>(0)

  // Reset bookkeeping whenever the active download identity changes.
  const lastKindRef = useRef<DownloadKind | null>(null)
  useEffect(() => {
    if (lastKindRef.current !== kind) {
      lastSampleAtRef.current = null
      lastBytesRef.current = null
      windowBytesRef.current = 0
      windowStartAtRef.current = null
      emaSpeedRef.current = null
      displayedSpeedRef.current = null
      lastFlushAtRef.current = 0
      patchEmaRef.current = null
      patchDisplayedSpeedRef.current = null
      lastPatchFlushAtRef.current = 0
      lastKindRef.current = kind
      setState({ kind, speed: null, stalled: false })
    }
  }, [kind])

  const depotBytes = showForDepot ? (depotProgress?.completedBytes ?? null) : null

  // Depot: windowed rate + EMA.
  useEffect(() => {
    if (!showForDepot || depotBytes === null) return

    const now = performance.now()
    const prevBytes = lastBytesRef.current

    if (prevBytes === null) {
      lastBytesRef.current = depotBytes
      windowStartAtRef.current = now
      windowBytesRef.current = 0
      return
    }

    const delta = depotBytes - prevBytes
    lastBytesRef.current = depotBytes

    if (delta < 0) {
      windowBytesRef.current = 0
      windowStartAtRef.current = now
      emaSpeedRef.current = null
      setState((prev) =>
        prev.kind === 'depot' && prev.speed === null && !prev.stalled
          ? prev
          : { kind: 'depot', speed: null, stalled: false },
      )
      return
    }

    if (delta > 0) windowBytesRef.current += delta

    const winStart = windowStartAtRef.current ?? now
    const elapsed = now - winStart
    const lastSample = lastSampleAtRef.current
    const wantSample =
      lastSample === null
        ? elapsed >= 500 && windowBytesRef.current > 0
        : elapsed >= RATE_WINDOW_MS &&
          now - lastSample >= SAMPLE_MIN_INTERVAL_MS
    if (!wantSample) return

    const instant = (windowBytesRef.current / elapsed) * 1000
    const ema =
      emaSpeedRef.current === null
        ? instant
        : EMA_ALPHA * instant + (1 - EMA_ALPHA) * emaSpeedRef.current
    emaSpeedRef.current = ema
    windowBytesRef.current = 0
    windowStartAtRef.current = now
    lastSampleAtRef.current = now

    const sinceLastFlush = now - lastFlushAtRef.current
    const prev = displayedSpeedRef.current
    const changedEnough =
      prev === null ||
      Math.abs(ema - prev) / Math.max(prev, 1) > 0.02 ||
      sinceLastFlush >= TOAST_UPDATE_INTERVAL_MS
    if (changedEnough) {
      lastFlushAtRef.current = now
      displayedSpeedRef.current = ema
      setState({ kind: 'depot', speed: ema, stalled: false })
    }
  }, [depotBytes, showForDepot, kind])

  // Depot: stall detection + first-sample promotion.
  useEffect(() => {
    if (!showForDepot) return
    const id = window.setInterval(() => {
      const now = performance.now()
      const lastTick = lastSampleAtRef.current
      if (lastTick === null) {
        if (emaSpeedRef.current !== null) {
          setState((prev) =>
            prev.kind === 'depot' && prev.speed === null && !prev.stalled
              ? { kind: 'depot', speed: emaSpeedRef.current, stalled: false }
              : prev,
          )
        }
        return
      }
      const sinceLast = now - lastTick
      setState((prev) => {
        if (prev.kind !== 'depot') return prev
        if (sinceLast >= STALL_TIMEOUT_MS && !prev.stalled) {
          return { kind: 'depot', speed: prev.speed, stalled: true }
        }
        if (sinceLast < STALL_TIMEOUT_MS && prev.stalled) {
          return { kind: 'depot', speed: prev.speed, stalled: false }
        }
        return prev
      })
    }, 500)
    return () => window.clearInterval(id)
  }, [showForDepot])

  // Patch: per-file speeds summed and EMA-smoothed.
  const patchRaw: number | null = (() => {
    if (!showForUpdate || !updateStatus?.files) return null
    let total = 0
    for (const f of updateStatus.files as UpdateProgressFile[]) {
      if (f.stage === 'downloading' && typeof f.speed === 'number') {
        total += f.speed
      }
    }
    return total > 0 ? total : null
  })()

  const [patchTick, setPatchTick] = useState(0)
  useEffect(() => {
    if (!showForUpdate) return
    const id = window.setInterval(() => setPatchTick((t) => t + 1), 250)
    return () => window.clearInterval(id)
  }, [showForUpdate])

  useEffect(() => {
    if (!showForUpdate) return
    void patchTick
    if (patchRaw === null) return
    const ema =
      patchEmaRef.current === null
        ? patchRaw
        : EMA_ALPHA * patchRaw + (1 - EMA_ALPHA) * patchEmaRef.current
    patchEmaRef.current = ema

    const now = performance.now()
    const sinceLastFlush = now - lastPatchFlushAtRef.current
    const prev = patchDisplayedSpeedRef.current
    const changedEnough =
      prev === null ||
      Math.abs(ema - prev) / Math.max(prev, 1) > 0.02 ||
      sinceLastFlush >= TOAST_UPDATE_INTERVAL_MS
    if (changedEnough) {
      lastPatchFlushAtRef.current = now
      patchDisplayedSpeedRef.current = ema
      setState({ kind: 'update', speed: ema, stalled: false })
    }
  }, [patchRaw, patchTick, showForUpdate])

  return state
}
