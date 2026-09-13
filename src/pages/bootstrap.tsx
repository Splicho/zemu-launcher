import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { invoke } from '@tauri-apps/api/core'
import { type DownloadEvent, check } from '@tauri-apps/plugin-updater'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { LAUNCHER_CONFIG } from '@/config/launcher'

type BootstrapPhase =
  | 'checking'
  | 'development'
  | 'up-to-date'
  | 'downloading'
  | 'restarting'
  | 'check-error'
  | 'install-error'

interface BootstrapState {
  phase: BootstrapPhase
  status: string
  detail: string
  error: string | null
  currentVersion: string
  latestVersion: string | null
  downloadedBytes: number
  totalBytes: number | null
  progress: number | null
}

const INITIAL_STATE: BootstrapState = {
  phase: 'checking',
  status: 'Checking launcher updates',
  detail: 'Looking for a newer launcher build before opening the app.',
  error: null,
  // Read from the bundled <meta> tag in index.html (kept in sync with
  // src/config/launcher.ts via the sync-launcher-config script).
  currentVersion: import.meta.env.VITE_APP_VERSION ?? '0.0.0',
  latestVersion: null,
  downloadedBytes: 0,
  totalBytes: null,
  progress: null,
}

/**
 * Bootstrap / updater screen.
 *
 * Loaded in Tauri's `bootstrap` window — a small, transparent, always-
 * on-top window created in `src-tauri/src/lib.rs`. Both Tauri windows
 * load the same `index.html`; `App.tsx` reads `getCurrentWindow().label`
 * to pick which page to render, so this component is the bootstrap label's
 * root render.
 *
 * Flow:
 *   1. `check()` from `@tauri-apps/plugin-updater` polls the
 *      `pubkey/endpoints` configured in `tauri.conf.json`.
 *   2. If an update is available: `downloadAndInstall()` with a
 *      progress callback that updates the on-screen bar. After the
 *      installer runs, we tell Rust to restart the app.
 *   3. If no update is available (or `check()` errors out
 *      non-fatally), call `invoke('launcher_finish_bootstrap')`.
 *      Rust closes this window and shows the main 1280×800 one.
 *
 * The small window (460×430, frameless, transparent) is intentional
 * — it's only meant to show the launcher logo + status briefly at
 * launch. The real launcher UI is the main window.
 *
 * Note: any error during update is surfaced as a small message + a
 * "Retry" / "Open launcher" / "Exit" button so the user isn't
 * trapped in the bootstrap window if the update server is down.
 */
export function BootstrapPage() {
  const { t } = useTranslation()
  const [state, setState] = useState<BootstrapState>(INITIAL_STATE)
  const mountedRef = useRef(true)
  const startedRef = useRef(false)

  useEffect(() => {
    document.documentElement.classList.add('bootstrap-window')

    return () => {
      document.documentElement.classList.remove('bootstrap-window')
    }
  }, [])

  const updateState = useCallback((next: Partial<BootstrapState> | BootstrapState) => {
    if (!mountedRef.current) {
      return
    }

    setState((current) => ({ ...current, ...next }))
  }, [])

  const openLauncher = useCallback(async () => {
    updateState({
      status: t('bootstrap.openingLauncher'),
      detail: t('bootstrap.bootstrappingComplete'),
      error: null,
    })

    try {
      await invoke('launcher_finish_bootstrap')
    } catch (error) {
      updateState({
        phase: 'check-error',
        status: t('bootstrap.couldNotOpenLauncher'),
        detail: t('bootstrap.launcherWindowFailed'),
        error: formatError(error, t),
      })
    }
  }, [updateState, t])

  const runBootstrap = useCallback(async () => {
    updateState(INITIAL_STATE)

    const updatesEnabled = await invoke<boolean>('launcher_updates_enabled').catch(() => false)
    if (!updatesEnabled) {
      updateState({
        phase: 'development',
        status: t('bootstrap.updaterSkipped'),
        detail: t('bootstrap.devBuildNote'),
        error: null,
        latestVersion: null,
        downloadedBytes: 0,
        totalBytes: null,
        progress: null,
      })
      await delay(350)
      await openLauncher()
      return
    }

    const update = await check().catch((error) => {
      updateState({
        phase: 'check-error',
        status: t('bootstrap.checkFailed'),
        detail: t('bootstrap.checkFailedDetail'),
        error: formatError(error, t),
        latestVersion: null,
        downloadedBytes: 0,
        totalBytes: null,
        progress: null,
      })
      return null
    })

    if (!update) {
      updateState({
        phase: 'up-to-date',
        status: t('bootstrap.upToDate'),
        detail: t('bootstrap.upToDateDetail'),
        error: null,
        latestVersion: null,
        downloadedBytes: 0,
        totalBytes: null,
        progress: 100,
      })
      await delay(450)
      await openLauncher()
      return
    }

    updateState({
      phase: 'downloading',
      status: t('bootstrap.downloading', { version: update.version }),
      detail: t('bootstrap.downloadingDetail'),
      error: null,
      currentVersion: update.currentVersion,
      latestVersion: update.version,
      downloadedBytes: 0,
      totalBytes: null,
      progress: 0,
    })

    let downloadedBytes = 0
    let totalBytes: number | null = null

    try {
      await update.downloadAndInstall((event) => {
        applyDownloadEvent(event, {
          onStart(contentLength) {
            totalBytes = contentLength ?? null
            updateState({
              totalBytes,
              progress: contentLength ? 0 : null,
            })
          },
          onProgress(chunkLength) {
            downloadedBytes += chunkLength
            updateState({
              downloadedBytes,
              totalBytes,
              progress: totalBytes
                ? Math.max(1, Math.min(99, Math.round((downloadedBytes / totalBytes) * 100)))
                : null,
            })
          },
          onFinish() {
            updateState({
              downloadedBytes: totalBytes ?? downloadedBytes,
              totalBytes,
              progress: 100,
            })
          },
        })
      })

      updateState({
        phase: 'restarting',
        status: t('bootstrap.restarting'),
        detail: t('bootstrap.restartingDetail'),
        error: null,
        progress: 100,
      })

      await invoke('launcher_restart_app')
    } catch (error) {
      updateState({
        phase: 'install-error',
        status: t('bootstrap.updateFailed'),
        detail: t('bootstrap.updateFailedDetail'),
        error: formatError(error, t),
        downloadedBytes,
        totalBytes,
      })
    } finally {
      await update.close().catch(() => undefined)
    }
  }, [openLauncher, updateState, t])

  useEffect(() => {
    mountedRef.current = true
    if (!startedRef.current) {
      startedRef.current = true
      void runBootstrap()
    }

    return () => {
      mountedRef.current = false
    }
  }, [runBootstrap])

  function retry() {
    void runBootstrap()
  }

  function exitLauncher() {
    void invoke('launcher_exit_app')
  }

  const showProgress = state.phase === 'downloading'
  const hasCheckError = state.phase === 'check-error'
  const hasInstallError = state.phase === 'install-error'
  const hasError = hasCheckError || hasInstallError
  const splashLabel =
    state.phase === 'checking'
      ? t('bootstrap.splashChecking')
      : state.phase === 'development' ||
          state.phase === 'up-to-date' ||
          state.phase === 'restarting'
        ? t('bootstrap.splashStarting')
        : null

  return (
    <div className="bootstrap-window flex h-screen w-screen items-center justify-center overflow-hidden bg-transparent px-4 py-4 text-foreground dark">
      <div className="flex h-full max-h-[22.5rem] w-full max-w-[19.5rem] flex-col items-center justify-center overflow-hidden rounded-[22px] bg-background px-12 py-12 shadow-[0_12px_36px_rgba(0,0,0,0.28)]">
        <motion.div
          className="flex items-center justify-center"
          animate={
            hasError
              ? { scale: 1, opacity: 1 }
              : { scale: [1, 1.06, 1], opacity: [0.96, 1, 0.96] }
          }
          transition={{
            duration: 2.4,
            ease: 'easeInOut',
            repeat: hasError ? 0 : Infinity,
          }}
        >
          <img
            src="./assets/icon/app-icon.ico"
            alt={LAUNCHER_CONFIG.name}
            className="h-24 w-24 object-contain"
          />
        </motion.div>

        {splashLabel ? (
          <p className="mt-6 text-center text-sm tracking-[0.08em] text-muted-foreground">
            {splashLabel}
          </p>
        ) : null}

        {showProgress ? (
          <div className="mt-10 w-full">
            <Progress className="h-1.5 bg-white/8" value={state.progress ?? undefined} />
          </div>
        ) : null}

        {hasCheckError ? (
          <div className="mt-8 flex w-full gap-3">
            <Button className="flex-1" size="lg" onClick={retry}>
              {t('common.retry')}
            </Button>
            <Button
              className="flex-1"
              size="lg"
              variant="outline"
              onClick={() => void openLauncher()}
            >
              {t('bootstrap.openLauncher')}
            </Button>
          </div>
        ) : null}

        {hasInstallError ? (
          <div className="mt-8 flex w-full gap-3">
            <Button className="flex-1" size="lg" onClick={retry}>
              {t('common.retry')}
            </Button>
            <Button className="flex-1" size="lg" variant="outline" onClick={exitLauncher}>
              {t('common.exit')}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function applyDownloadEvent(
  event: DownloadEvent,
  handlers: {
    onStart: (contentLength?: number) => void
    onProgress: (chunkLength: number) => void
    onFinish: () => void
  },
) {
  if (event.event === 'Started') {
    handlers.onStart(event.data.contentLength)
    return
  }

  if (event.event === 'Progress') {
    handlers.onProgress(event.data.chunkLength)
    return
  }

  handlers.onFinish()
}

function formatError(error: unknown, t: ReturnType<typeof useTranslation>['t']) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return t('bootstrap.unexpectedError')
}

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
