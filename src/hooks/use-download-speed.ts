import { useEffect, useRef, useState } from 'react'
import { useGameStateContext } from '@/contexts/game-state-context'
import type { UpdateProgressFile } from '@/lib/tauri-bridge'

const EMA_ALPHA = 0.35
// Only re-flush React state when the *displayed* values change. The raw EMA
// keeps running on every sample; this just gates React work.
const TOAST_UPDATE_INTERVAL_MS = 150

export type DownloadKind = 'update'

export interface DownloadSpeed {
  kind: DownloadKind | null
  speed: number | null
  stalled: boolean
}

/**
 * Shared speed derivation for the update/patch flow.
 *
 * Patch branch:
 *   - The Rust side already reports per-file `speed`, but those are noisy
 *     instantaneous values. Sum them and EMA-smooth the sum.
 *
 * Returns the smoothed speed + a stall flag, plus which branch is active so
 * consumers (toast, ETA, button label) can switch behaviour.
 */
export function useDownloadSpeed(): DownloadSpeed {
  const { isUpdating, updateStatus } = useGameStateContext()

  const showForUpdate =
    isUpdating && updateStatus !== null && updateStatus.isUpdating
  const kind: DownloadKind | null = showForUpdate
    ? 'update'
    : null

  const [state, setState] = useState<DownloadSpeed>({
    kind: null,
    speed: null,
    stalled: false,
  })

  // ── Patch refs ────────────────────────────────────────────────────────────
  const patchEmaRef = useRef<number | null>(null)
  const patchDisplayedSpeedRef = useRef<number | null>(null)
  const lastPatchFlushAtRef = useRef<number>(0)

  // Reset bookkeeping whenever the active download identity changes.
  const lastKindRef = useRef<DownloadKind | null>(null)
  useEffect(() => {
    if (lastKindRef.current !== kind) {
      lastKindRef.current = kind
      setState({ kind, speed: null, stalled: false })
    }
  }, [kind])

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
