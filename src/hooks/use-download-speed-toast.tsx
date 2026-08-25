import { useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import { useGameStateContext } from '@/contexts/game-state-context'
import { useDownloadSpeed } from '@/hooks/use-download-speed'
import { useDownloadEta } from '@/hooks/use-download-eta'

function formatSpeed(bytesPerSecond: number | null, stalled: boolean): string {
  if (stalled) return 'Stalled'
  if (bytesPerSecond === null || bytesPerSecond <= 0) return 'Calculating…'
  const mbps = bytesPerSecond / (1024 * 1024)
  if (mbps >= 1) return `${mbps.toFixed(1)} MB/s`
  return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`
}

/**
 * Shows a Sonner toast while any download is active (Steam depot or Zemu
 * patch). Speed is owned by `useDownloadSpeed` and ETA by `useDownloadEta`,
 * both shared with the rest of the UI so we don't run duplicate smoothing
 * loops.
 *
 * The toast uses the native `loading` variant for the shadcn loader chrome
 * and is updated in-place via a stable toast id. The description combines
 * speed + ETA:
 *
 *     5.4 MB/s · 54m 21s remaining
 *
 * Terminal handling: when the active toast closes, we don't show our own
 * "complete" toast on cancel or failure — the depot branch already toasts
 * "Base game downloaded" on success (via `use-game-state.ts`) and
 * "Update failed" on backend error, and we don't want a duplicate (or a
 * misleading "complete" after a cancel).
 */
export function useDownloadSpeedToast() {
  const { isDownloadingDepot, depotProgress, isUpdating, updateStatus } =
    useGameStateContext()
  const { kind, speed, stalled } = useDownloadSpeed()
  const eta = useDownloadEta()

  const isActive =
    (isDownloadingDepot && kind === 'depot') ||
    (isUpdating && kind === 'update')

  const title = kind === 'depot' ? 'Downloading KotK' : kind === 'update' ? 'Updating KotK' : ''
  const description = useMemo(() => {
    const speedText = formatSpeed(speed, stalled)
    if (stalled) return speedText
    if (eta) return `${speedText} · ${eta} remaining`
    return speedText
  }, [speed, stalled, eta])

  // Snapshot the current terminal phase. Read directly from props in the
  // close-time effect below so we don't miss the terminal event arriving
  // *after* the active toast has already been dismissed by the optimistic
  // cancel path.
  const currentTerminalPhase: 'done' | 'cancelled' | 'failed' | null = (() => {
    if (kind === 'depot' && depotProgress) {
      if (depotProgress.phase === 'done') return 'done'
      if (depotProgress.phase === 'cancelled') return 'cancelled'
      if (depotProgress.phase === 'failed') return 'failed'
    }
    if (kind === 'update' && updateStatus?.error) {
      return 'failed'
    }
    return null
  })()

  const activeToastIdRef = useRef<string | number | null>(null)
  const lastTitleRef = useRef<'depot' | 'update' | null>(null)
  // Last terminal phase we observed while the active toast was up. Used to
  // decide what to show (if anything) when the active toast closes.
  const lastTerminalPhaseRef = useRef<
    'done' | 'cancelled' | 'failed' | null
  >(null)

  useEffect(() => {
    if (isActive && currentTerminalPhase) {
      lastTerminalPhaseRef.current = currentTerminalPhase
    }
  }, [isActive, currentTerminalPhase])

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
      toast.loading(title, {
        id: activeToastIdRef.current,
        description,
        duration: Infinity,
      })
    }
  }, [isActive, kind, title, description])

  // When the active toast closes, show a brief follow-up only for clean
  // completions. Cancel/failure are deliberately silent here because the
  // backend (or `use-game-state`) already shows its own terminal toast.
  useEffect(() => {
    if (isActive) return

    if (activeToastIdRef.current !== null) {
      const previousTitle =
        lastTitleRef.current === 'update' ? 'Updating KotK' : 'Downloading KotK'
      const terminal =
        lastTerminalPhaseRef.current ?? currentTerminalPhase

      lastTitleRef.current = null
      lastTerminalPhaseRef.current = null

      if (terminal === 'done') {
        toast.success(`${previousTitle} complete`, {
          id: '__download-speed-done__',
          duration: 3000,
        })
      }

      toast.dismiss(activeToastIdRef.current)
      activeToastIdRef.current = null
    }
  }, [isActive, currentTerminalPhase])
}
