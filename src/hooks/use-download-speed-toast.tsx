import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useGameStateContext } from '@/contexts/game-state-context'
import type { UpdateProgressFile } from '@/lib/tauri-bridge'

const SPEED_WINDOW_MS = 4000

interface SpeedSample {
  ts: number
  bytes: number
}

function formatSpeed(bytesPerSecond: number | null): string {
  if (bytesPerSecond === null || bytesPerSecond <= 0) return 'Calculating...'
  const mbps = bytesPerSecond / (1024 * 1024)
  if (mbps >= 1) return `${mbps.toFixed(1)} MB/s`
  return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`
}

/**
 * Shows a Sonner toast while any download is active (Steam depot or Zemu
 * patch). The toast uses the native `loading` variant so we get the shadcn
 * loader icon + chrome for free; speed and percent are passed as the
 * description and updated in-place via the shared toast id.
 */
export function useDownloadSpeedToast() {
  const { isDownloadingDepot, depotProgress, isUpdating, updateStatus } =
    useGameStateContext()

  const samplesRef = useRef<SpeedSample[]>([])
  const lastBytesRef = useRef<number | null>(null)
  const lastTitleRef = useRef<'depot' | 'update' | null>(null)
  const activeToastIdRef = useRef<string | number | null>(null)
  const doneToastIdRef = useRef<string | number | null>(null)
  const showForDepot =
    isDownloadingDepot &&
    depotProgress !== null &&
    (depotProgress.phase === 'chunk_progress' ||
      depotProgress.phase === 'file_started' ||
      depotProgress.phase === 'file_completed')

  const showForUpdate = isUpdating && updateStatus !== null && updateStatus.isUpdating
  const isActive = showForDepot || showForUpdate
  const kind: 'depot' | 'update' | null = showForDepot
    ? 'depot'
    : showForUpdate
      ? 'update'
      : null

  // ── Speed derivation (depot only; updates carry their own per-file speed) ──
  if (showForDepot && depotProgress) {
    const bytes = depotProgress.completedBytes ?? 0
    const now = performance.now()

    if (lastBytesRef.current === null) {
      lastBytesRef.current = bytes
      samplesRef.current = [{ ts: now, bytes }]
    } else if (bytes !== lastBytesRef.current) {
      lastBytesRef.current = bytes
      samplesRef.current.push({ ts: now, bytes })
    }

    const cutoff = now - SPEED_WINDOW_MS
    while (
      samplesRef.current.length > 2 &&
      samplesRef.current[0].ts < cutoff
    ) {
      samplesRef.current.shift()
    }
  }

  let bytesPerSecond: number | null = null
  if (showForDepot && samplesRef.current.length >= 2) {
    const first = samplesRef.current[0]
    const last = samplesRef.current[samplesRef.current.length - 1]
    const dt = (last.ts - first.ts) / 1000
    const dBytes = last.bytes - first.bytes
    if (dt > 0 && dBytes >= 0) bytesPerSecond = dBytes / dt
  }

  let patchSpeed: number | null = null
  if (showForUpdate && updateStatus?.files) {
    let total = 0
    for (const f of updateStatus.files as UpdateProgressFile[]) {
      if (f.stage === 'downloading' && typeof f.speed === 'number') {
        total += f.speed
      }
    }
    if (total > 0) patchSpeed = total
  }

  const activeSpeed = showForUpdate ? patchSpeed : bytesPerSecond

  // ── Percent ────────────────────────────────────────────────────────────────
  let percent: number | null = null
  if (showForDepot && depotProgress) {
    if (typeof depotProgress.percent === 'number') {
      percent = depotProgress.percent
    } else if ((depotProgress.totalBytes ?? 0) > 0) {
      percent = ((depotProgress.completedBytes ?? 0) / depotProgress.totalBytes!) * 100
    }
  } else if (showForUpdate && updateStatus) {
    percent = updateStatus.overallProgress
  }

  const title = kind === 'depot' ? 'Downloading KotK' : kind === 'update' ? 'Updating KotK' : ''
  const description =
    `${formatSpeed(activeSpeed)}` +
    (percent !== null ? ` · ${Math.round(percent)}%` : '')

  // Show / update the active toast
  useEffect(() => {
    if (!isActive || !kind) return

    // Title changed (depot ↔ update) — dismiss the old one and re-create
    if (lastTitleRef.current && lastTitleRef.current !== kind) {
      if (activeToastIdRef.current !== null) {
        toast.dismiss(activeToastIdRef.current)
        activeToastIdRef.current = null
      }
    }
    lastTitleRef.current = kind

    if (activeToastIdRef.current === null) {
      activeToastIdRef.current = toast.loading(title, {
        id: '__download-speed__',
        description,
        duration: Infinity,
      })
    } else {
      // Same id → Sonner updates the description in-place
      toast.loading(title, {
        id: activeToastIdRef.current,
        description,
        duration: Infinity,
      })
    }
  }, [isActive, kind, title, description])

  // Replace with a success toast when the download finishes
  useEffect(() => {
    if (isActive) return

    if (activeToastIdRef.current !== null) {
      const previousKind = lastTitleRef.current
      const previousTitle =
        previousKind === 'update' ? 'Updating KotK' : 'Downloading KotK'

      // Clear samples so a re-triggered download starts fresh
      samplesRef.current = []
      lastBytesRef.current = null
      lastTitleRef.current = null

      doneToastIdRef.current = toast.success(`${previousTitle} complete`, {
        id: '__download-speed-done__',
        duration: 3000,
      })
      toast.dismiss(activeToastIdRef.current)
      activeToastIdRef.current = null
    }
  }, [isActive])
}
