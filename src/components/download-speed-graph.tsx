import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useGameStateContext } from '@/contexts/game-state-context'
import type { UpdateProgressFile } from '@/lib/tauri-bridge'

/**
 * Rolling window of (timestamp, bytes) samples used to derive a smoothed
 * download speed for the depot (Steam) path — the backend doesn't emit a
 * speed field for depot chunk events, so we compute it here.
 */
const SPEED_WINDOW_MS = 4000
const HISTORY_POINTS = 60 // ~last 60 samples → ~4s @ 1 sample / 67ms

interface SpeedSample {
  ts: number
  bytes: number
}

interface DisplayState {
  visible: boolean
  /** Most recent smoothed speed in bytes/second. */
  bytesPerSecond: number
  /** Short label (e.g. "Steam download", "Updating"). */
  label: string
  /** Current percent (0–100) for the progress ring, if known. */
  percent: number | null
}

/**
 * Slide-up download-speed graph.
 *
 * - Mounts at the bottom of the viewport and animates up while any download
 *   is active (Steam depot or Zemu patch).
 * - Animates back down when the download finishes / fails / is cancelled.
 * - Speed is read directly from the patch's `UpdateProgressFile.speed`
 *   entries, or computed from a rolling delta on the depot's
 *   `completedBytes` (the Steam side doesn't ship a speed field).
 * - The line is drawn on a tiny <svg> that re-renders each animation frame
 *   via `requestAnimationFrame`, fading toward the primary color at the
 *   top edge.
 */
export function DownloadSpeedGraph() {
  const { depotProgress, updateStatus, isUpdating, isDownloadingDepot } =
    useGameStateContext()

  const samplesRef = useRef<SpeedSample[]>([])
  const lastBytesRef = useRef<number | null>(null)
  const [bytesPerSecond, setBytesPerSecond] = useState(0)
  const lastEmitRef = useRef(0)

  // Whether the graph should be visible. We show it only during real
  // *download* work — not during the Steam auth/manifest-fetch setup
  // (that's covered by DownloadProgressDialog).
  const showForDepot =
    isDownloadingDepot &&
    depotProgress !== null &&
    (depotProgress.phase === 'chunk_progress' ||
      depotProgress.phase === 'file_started' ||
      depotProgress.phase === 'file_completed')

  const showForUpdate = isUpdating && updateStatus !== null && updateStatus.isUpdating

  const visible = showForDepot || showForUpdate

  const percent = useMemo(() => {
    if (showForDepot && depotProgress) {
      if (typeof depotProgress.percent === 'number') return depotProgress.percent
      const total = depotProgress.totalBytes ?? 0
      if (total > 0) {
        return Math.min(
          100,
          Math.max(0, ((depotProgress.completedBytes ?? 0) / total) * 100),
        )
      }
    }
    if (showForUpdate && updateStatus) {
      return updateStatus.overallProgress
    }
    return null
  }, [showForDepot, showForUpdate, depotProgress, updateStatus])

  const label = showForDepot ? 'Steam download' : showForUpdate ? 'Updating' : ''

  // --- Speed derivation -----------------------------------------------------
  // For depot: rolling delta of (completedBytes) over the SPEED_WINDOW_MS.
  useEffect(() => {
    if (!showForDepot || !depotProgress) {
      samplesRef.current = []
      lastBytesRef.current = null
      setBytesPerSecond(0)
      return
    }

    const bytes = depotProgress.completedBytes ?? 0
    const now = performance.now()

    // Seed the first sample so we don't report a bogus spike.
    if (lastBytesRef.current === null) {
      lastBytesRef.current = bytes
      samplesRef.current.push({ ts: now, bytes })
      return
    }

    samplesRef.current.push({ ts: now, bytes })

    // Drop samples outside the window.
    const cutoff = now - SPEED_WINDOW_MS
    while (
      samplesRef.current.length > 2 &&
      samplesRef.current[0].ts < cutoff
    ) {
      samplesRef.current.shift()
    }

    // Throttle state updates to ~10Hz — smoother UI, less re-render churn.
    if (now - lastEmitRef.current < 100) return
    lastEmitRef.current = now

    const first = samplesRef.current[0]
    const last = samplesRef.current[samplesRef.current.length - 1]
    const dt = (last.ts - first.ts) / 1000
    const dBytes = last.bytes - first.bytes
    if (dt > 0 && dBytes >= 0) {
      setBytesPerSecond(dBytes / dt)
    }

    lastBytesRef.current = bytes
  }, [depotProgress, showForDepot])

  // For patch: aggregate the per-file `speed` field from UpdateProgressFile
  // entries that are currently downloading. Backend emits speeds in bytes/s.
  const patchSpeed = useMemo(() => {
    if (!showForUpdate || !updateStatus?.files) return 0
    let total = 0
    for (const f of updateStatus.files as UpdateProgressFile[]) {
      if (f.stage === 'downloading' && typeof f.speed === 'number') {
        total += f.speed
      }
    }
    return total
  }, [showForUpdate, updateStatus])

  useEffect(() => {
    if (showForUpdate) setBytesPerSecond(patchSpeed)
  }, [patchSpeed, showForUpdate])

  // --- History for the graph line ------------------------------------------
  const [history, setHistory] = useState<number[]>([])
  const peakRef = useRef(1)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!visible) {
      setHistory([])
      peakRef.current = 1
      return
    }

    const tick = () => {
      setHistory((prev) => {
        const next = [...prev, bytesPerSecond]
        // Smooth peak so a single tall spike doesn't squash the rest.
        peakRef.current = Math.max(
          peakRef.current * 0.985,
          bytesPerSecond,
          1,
        )
        return next.length > HISTORY_POINTS
          ? next.slice(next.length - HISTORY_POINTS)
          : next
      })
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [visible, bytesPerSecond])

  const display: DisplayState = {
    visible,
    bytesPerSecond,
    label,
    percent,
  }

  return <DownloadSpeedGraphPanel display={display} history={history} peakRef={peakRef} />
}

/**
 * Pure presentational panel. Kept separate from the hook-driven parent so
 * the SVG path computation (which runs on every animation frame) can be
 * reasoned about in isolation.
 */
function DownloadSpeedGraphPanel({
  display,
  history,
  peakRef,
}: {
  display: DisplayState
  history: number[]
  peakRef: React.MutableRefObject<number>
}) {
  // SVG geometry — fixed viewBox so path math stays simple.
  const W = 320
  const H = 56

  const pathD = useMemo(() => {
    if (history.length < 2) return ''
    const stepX = W / (HISTORY_POINTS - 1)
    const startX = W - (history.length - 1) * stepX
    return history
      .map((bps, i) => {
        const x = startX + i * stepX
        const y = H - (bps / peakRef.current) * (H - 4) - 2
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
      })
      .join(' ')
  }, [history, peakRef])

  const fillD = pathD
    ? `${pathD} L ${W} ${H} L ${W - (history.length - 1) * (W / (HISTORY_POINTS - 1))} ${H} Z`
    : ''

  return (
    <AnimatePresence>
      {display.visible ? (
        <motion.div
          key="speed-graph"
          initial={{ y: '110%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '110%', opacity: 0 }}
          transition={{ type: 'spring', stiffness: 220, damping: 26 }}
          className="fixed bottom-0 left-0 right-0 z-40 flex justify-center pointer-events-none"
        >
          <div
            className="pointer-events-auto mb-4 rounded-xl border border-primary/20 bg-card/85 backdrop-blur-md shadow-lg shadow-primary/10 px-5 py-3 flex items-center gap-5"
            role="status"
            aria-live="polite"
          >
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {display.label}
              </span>
              <span className="font-mono text-base font-semibold text-foreground tabular-nums">
                {formatSpeed(display.bytesPerSecond)}
              </span>
            </div>

            <svg
              width={W}
              height={H}
              viewBox={`0 0 ${W} ${H}`}
              className="overflow-visible"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="speed-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.55" />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="speed-line" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="1" />
                </linearGradient>
              </defs>
              {fillD ? <path d={fillD} fill="url(#speed-fill)" /> : null}
              {pathD ? (
                <path
                  d={pathD}
                  fill="none"
                  stroke="url(#speed-line)"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : null}
            </svg>

            {display.percent !== null ? (
              <div className="flex flex-col items-end min-w-[58px]">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Progress
                </span>
                <span className="font-mono text-base font-semibold text-foreground tabular-nums">
                  {Math.round(display.percent)}%
                </span>
              </div>
            ) : null}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function formatSpeed(bytesPerSecond: number): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return '— MB/s'
  const mbps = bytesPerSecond / (1024 * 1024)
  if (mbps >= 1) return `${mbps.toFixed(2)} MB/s`
  const kbps = bytesPerSecond / 1024
  return `${kbps.toFixed(0)} KB/s`
}