import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { check, type DownloadEvent } from '@tauri-apps/plugin-updater'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useHash } from '@/hooks/use-hash'

/**
 * Bootstrap / updater screen.
 *
 * Loaded in Tauri's `bootstrap` window (a small, transparent, always-
 * on-top window defined in `src-tauri/tauri.conf.json` with
 * `url: "index.html#/bootstrap"`). The window auto-creates at app
 * launch and is the first thing the user sees.
 *
 * Flow:
 *   1. `check()` from `@tauri-apps/plugin-updater` polls the
 *      `pubkey/endpoints` configured in `tauri.conf.json`.
 *   2. If an update is available: `downloadAndInstall()` with a
 *      progress callback that updates the on-screen bar. After the
 *      installer runs, Tauri restarts the app automatically and this
 *      window goes away.
 *   3. If no update is available (or `check()` errors out
 *      non-fatally), call `invoke('launcher_finish_bootstrap')`.
 *      Rust then closes this window and creates the main 1280×800
 *      launcher window.
 *
 * The small window (460×430, frameless, transparent) is intentional
 * — it's only meant to show "Updating..." briefly at launch. The
 * real launcher UI is the main window.
 *
 * Note: any error during update is surfaced as a small message + a
 * "Skip & continue" button so the user isn't trapped in the
 * bootstrap window if the update server is down. Same fallback the
 * abyssal-gate launcher uses.
 */
type Status = 'checking' | 'downloading' | 'installing' | 'no-update' | 'error'

export function BootstrapPage() {
  const hash = useHash()
  const [status, setStatus] = useState<Status>('checking')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [downloadedBytes, setDownloadedBytes] = useState(0)
  const [totalBytes, setTotalBytes] = useState<number | null>(null)

  // Run the update check once on mount. The hook is keyed on the
  // current hash so navigating away (e.g. via devtools) doesn't
  // re-trigger it.
  useEffect(() => {
    if (hash !== '/bootstrap') return

    let cancelled = false
    void runUpdateCheck(cancelled)

    return () => {
      cancelled = true
    }

    async function runUpdateCheck(cancelled: boolean) {
      try {
        const update = await check()
        if (cancelled) return

        if (!update) {
          await finishBootstrap()
          return
        }

        // Update available — start the download. The download + install
        // is a single API on the JS side; progress events flow through
        // the callback.
        setStatus('downloading')
        const total = update.rawJson?.['size'] as number | undefined
        if (typeof total === 'number') setTotalBytes(total)

        await update.downloadAndInstall((event: DownloadEvent) => {
          if (cancelled) return
          switch (event.event) {
            case 'Started':
              setTotalBytes(event.data.contentLength ?? total ?? null)
              break
            case 'Progress': {
              setDownloadedBytes((prev) => {
                const next = prev + event.data.chunkLength
                if (total && total > 0) {
                  setProgress(Math.min(100, (next / total) * 100))
                }
                return next
              })
              break
            }
            case 'Finished':
              setProgress(100)
              setStatus('installing')
              break
          }
        })
        // downloadAndInstall doesn't resolve until the installer has
        // been spawned. Tauri then restarts the app, so we never get
        // to render past this point in the happy path.
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Update failed'
        setError(message)
        setStatus('error')
      }
    }
  }, [hash])

  const finishBootstrap = async () => {
    setStatus('no-update')
    try {
      await invoke('launcher_finish_bootstrap')
      // Rust will close this window and show the main one. No further
      // state to set here — the React tree will be unmounted.
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to finish bootstrap'
      setError(message)
      setStatus('error')
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-transparent">
      <div className="flex w-[380px] flex-col items-center gap-5 rounded-xl border border-border bg-card/95 p-8 text-center shadow-2xl backdrop-blur-sm">
        <img
          src="./assets/icon/app-icon.ico"
          alt=""
          aria-hidden="true"
          className="h-14 w-14"
          onError={(e) => {
            // The icon path is bundle-relative — fall back to a
            // neutral spinner if the file isn't present in dev. The
            // production build includes it via Tauri's resource
            // bundler.
            ;(e.currentTarget as HTMLImageElement).style.display = 'none'
          }}
        />

        <div className="space-y-1">
          <h1 className="text-lg font-semibold text-foreground">Zemu Launcher</h1>
          <p className="text-xs text-muted-foreground">{statusLabel(status, progress, totalBytes, downloadedBytes)}</p>
        </div>

        {/* Progress bar — only meaningful during downloading.
            Hidden during checking / no-update / error. Uses the
            zemu primary (warm red) as the fill color via Tailwind. */}
        {status === 'downloading' && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-[width] duration-200 ease-out"
              style={{ width: `${Math.max(2, progress)}%` }}
            />
          </div>
        )}

        {status === 'checking' && (
          <Spinner className="size-5 text-muted-foreground" />
        )}

        {status === 'error' && (
          <div className="flex w-full flex-col gap-3">
            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-left text-xs text-destructive">
                {error}
              </div>
            )}
            <Button
              variant="default"
              size="sm"
              onClick={() => void finishBootstrap()}
              className="w-full"
            >
              Skip &amp; continue
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function statusLabel(
  status: Status,
  progress: number,
  totalBytes: number | null,
  downloadedBytes: number,
): string {
  switch (status) {
    case 'checking':
      return 'Checking for updates…'
    case 'downloading': {
      if (totalBytes && totalBytes > 0) {
        const mb = (n: number) => (n / 1024 / 1024).toFixed(1)
        return `Downloading update — ${mb(downloadedBytes)} / ${mb(totalBytes)} MB (${Math.round(progress)}%)`
      }
      return `Downloading update — ${Math.round(progress)}%`
    }
    case 'installing':
      return 'Installing update…'
    case 'no-update':
      return 'Up to date — launching…'
    case 'error':
      return 'Update failed'
  }
}