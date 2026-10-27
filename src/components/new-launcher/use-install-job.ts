import { useCallback, useEffect, useRef, useState } from 'react'

import type { InstallJobRecord } from '@/lib/tauri-bridge'

/**
 * Install job driver — Steam depot client download.
 *
 * Phase 2 of `C:\ZEmu\plan.md`: the depot download (the "client" stage)
 * is driven from the launcher shell instead of the onboarding wizard.
 * The Rust side already runs the whole pipeline in one call
 * (`steam_start_install_pipeline`) and emits everything the UI needs:
 *
 *   steam-qr → steam-scanned → steam-authed
 *   → depot-progress … → depot-done | depot-error
 *
 * This hook turns those events into one small state object for the
 * footer (stage word + bar) and for the QR dialog. It deliberately owns
 * no UI: the footer renders progress, `InstallAuthDialog` renders the
 * QR, and the patch stage belongs to `useGameState` (the footer starts
 * it when this job reports `done`).
 *
 * The pipeline is left running if the dialog is dismissed — closing a
 * dialog must not cancel a download. Only an explicit retry resets it.
 */

export type InstallStage =
  | 'idle'
  | 'starting'
  | 'auth'
  | 'preparing'
  | 'client'
  | 'done'
  | 'error'

interface InstallJobState {
  stage: InstallStage
  /** 0–100 for the client stage. */
  percent: number
  /** Bytes per second reported by the depot client. */
  speedBps: number
  /** Data URL of the Steam QR challenge, when auth is required. */
  qrDataUrl: string | null
  accountName: string | null
  error: string | null
}

const IDLE: InstallJobState = {
  stage: 'idle',
  percent: 0,
  speedBps: 0,
  qrDataUrl: null,
  accountName: null,
  error: null,
}

/**
 * A persisted job older than this is treated as dead. Without an expiry a
 * record that never got cleared (crash during the final write, files
 * deleted by hand) would offer "Resume" forever.
 */
const STALE_AFTER_SECONDS = 24 * 60 * 60

export function useInstallJob() {
  const [state, setState] = useState<InstallJobState>(IDLE)
  /** Persisted job from a previous session, when still fresh. */
  const [resumable, setResumable] = useState<InstallJobRecord | null>(null)
  const unsubscribersRef = useRef<Array<() => void>>([])

  const detach = useCallback(() => {
    for (const unsubscribe of unsubscribersRef.current) {
      try {
        unsubscribe()
      } catch {
        // A listener that already went away is not an error.
      }
    }
    unsubscribersRef.current = []
  }, [])

  useEffect(() => detach, [detach])

  // Load a job left behind by a previous session. Stale records are
  // cleared rather than offered, so a dead job can't latch the button.
  useEffect(() => {
    let cancelled = false
    void window.gameAPI
      ?.getInstallJob?.()
      .then((record) => {
        if (cancelled || !record) return
        const age = Math.floor(Date.now() / 1000) - record.updatedAtUnix
        if (age > STALE_AFTER_SECONDS) {
          void window.gameAPI?.clearInstallJob?.().catch(() => undefined)
          return
        }
        setResumable(record)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [])

  const clearRecord = useCallback(async () => {
    setResumable(null)
    try {
      await window.gameAPI?.clearInstallJob?.()
    } catch {
      // A stale file on disk is handled by the age check above.
    }
  }, [])

  const reset = useCallback(() => {
    detach()
    setState(IDLE)
  }, [detach])

  const start = useCallback(
    async (destination: string) => {
      const steam = window.steamApi
      if (!steam) {
        setState({ ...IDLE, stage: 'error', error: 'Steam bridge unavailable' })
        return
      }

      detach()
      // `starting` — not `auth`. The Rust side tries the persisted Steam
      // session first, so a returning user typically never sees a QR; the
      // button must not claim "Sign in to Steam" before that is known.
      setState({ ...IDLE, stage: 'starting' })
      setResumable(null)

      // Persist the job before the first byte lands so a crash still
      // offers Resume on the next launch.
      void window.gameAPI?.setInstallJob?.(destination, 'client').catch(() => undefined)

      unsubscribersRef.current = [
        steam.onQr((dataUrl) =>
          setState((prev) => ({ ...prev, stage: 'auth', qrDataUrl: dataUrl, error: null })),
        ),
        steam.onScanned(() => setState((prev) => ({ ...prev, qrDataUrl: null }))),
        steam.onAuthed((accountName) =>
          setState((prev) => ({
            ...prev,
            // Signed in, but the manifest is still being fetched — no bytes
            // yet, so this is *not* the download stage.
            stage: 'preparing',
            accountName,
            qrDataUrl: null,
            error: null,
          })),
        ),
        steam.onDepotProgress((progress) =>
          setState((prev) => {
            // `login` / `manifest` events carry no bytes. Treating them as
            // download progress is what put a 0 % bar and an em-dash speed on
            // screen before anything was actually transferring.
            const transferring = progress.stage === 'download' || progress.stage === 'file'
            if (!transferring) {
              return prev.stage === 'auth' || prev.stage === 'starting'
                ? { ...prev, stage: 'preparing' }
                : prev
            }

            const total = progress.bytesTotal ?? 0
            const done = progress.bytesDone ?? 0
            const computed =
              total > 0 ? Math.min(100, Math.max(0, (done / total) * 100)) : prev.percent
            // Never let the bar go backwards inside a job. Some events are
            // emitted with a zero byte count (a failed chunk being retried,
            // an out-of-order manifest update), which used to snap 13 % → 0 %
            // → 13 % several times a second.
            const percent = Math.max(prev.percent, computed)
            // Non-transfer events (`file`, `manifest`) carry `speedBps: 0`.
            // Keeping the last real sample stops the readout flickering to
            // an em dash between chunks.
            const incomingSpeed = progress.speedBps ?? 0
            return {
              ...prev,
              stage: 'client',
              percent,
              speedBps: incomingSpeed > 0 ? incomingSpeed : prev.speedBps,
            }
          }),
        ),
        steam.onDepotDone(() => {
          // Client files are on disk; the job is now the patch stage, so
          // a crash between here and "patch complete" still resumes.
          void window.gameAPI?.setInstallJob?.(destination, 'patch').catch(() => undefined)
          setState((prev) => ({ ...prev, stage: 'done', percent: 100, qrDataUrl: null }))
        }),
        steam.onDepotError((error) =>
          setState((prev) => ({ ...prev, stage: 'error', error: error.message, qrDataUrl: null })),
        ),
        steam.onLoginError((error) =>
          // Keep any QR that is already on screen: the panel then shows the
          // failure inline (with Retry) instead of closing itself, which
          // previously looked like the dialog had simply vanished.
          setState((prev) => ({ ...prev, stage: 'error', error: error.message })),
        ),
      ]

      try {
        await steam.startInstallPipeline(destination)
      } catch (err) {
        setState((prev) => ({
          ...prev,
          stage: 'error',
          qrDataUrl: null,
          error: err instanceof Error ? err.message : String(err),
        }))
      }
    },
    [detach],
  )

  return {
    stage: state.stage,
    percent: state.percent,
    speedBps: state.speedBps,
    qrDataUrl: state.qrDataUrl,
    accountName: state.accountName,
    error: state.error,
    /** Job left behind by a previous session (fresh within 24 h). */
    resumable,
    start,
    reset,
    clearRecord,
  }
}
