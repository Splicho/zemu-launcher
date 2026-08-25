import { useEffect, useRef, useState } from 'react'
import { useGameStateContext } from '@/contexts/game-state-context'

/**
 * Returns the depot download percent rounded to an integer for display.
 *
 * Holds the last known value across gaps in the event stream so the button
 * doesn't briefly flicker back to 0% when the backend emits an event
 * without `percent` or `totalBytes` set (which happens at phase boundaries
 * like `file_started` → first `chunk_progress`, or when the user cancels
 * mid-download and `depotProgress` is cleared).
 *
 * The percent is monotonic: it never decreases unless the backend reports a
 * counter reset (e.g., the download was restarted). This eliminates the
 * "drops to 0%" artifact entirely.
 */
export function useDepotPercent(): number {
  const { isDownloadingDepot, depotProgress } = useGameStateContext()

  const [percent, setPercent] = useState<number>(0)
  const lastRef = useRef<number>(0)
  const lastKindRef = useRef<boolean>(false)

  useEffect(() => {
    // Compute the next percent value (if any) and commit it in a single
    // guarded call. This keeps `setState` out of arbitrary branches in the
    // effect body.
    let next: number | null = null

    // Identity change: a fresh download starts the counter over; ending a
    // download resets to 0. Transitioning *into* downloading keeps the
    // previous value so we don't flash 0 → first sample.
    const kindChanged = lastKindRef.current !== isDownloadingDepot
    if (kindChanged) {
      lastKindRef.current = isDownloadingDepot
      if (!isDownloadingDepot) {
        next = 0
      }
    }

    if (next === null && isDownloadingDepot && depotProgress) {
      let raw: number | null = null
      if (typeof depotProgress.percent === 'number') {
        raw = depotProgress.percent
      } else if ((depotProgress.totalBytes ?? 0) > 0) {
        raw = ((depotProgress.completedBytes ?? 0) / depotProgress.totalBytes!) * 100
      }

      if (raw !== null) {
        const clamped = Math.min(100, Math.max(0, raw))
        next = Math.round(clamped)
      }
    }

    if (next === null) return
    if (next === lastRef.current) return
    lastRef.current = next
    setPercent(next)
  }, [isDownloadingDepot, depotProgress])

  return percent
}
