import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Folder, FolderOpen, ClipboardCopy } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

/**
 * Advanced settings tab.
 *
 * Today this is a thin "where is my data" page — exactly the
 * question a user has to answer when filing a bug report or moving
 * to a new machine. Everything else (debug toggles, verbose
 * logging, factory reset, etc.) lives in code paths we don't
 * expose yet; the page is structured as discrete cards so we can
 * add sections without re-flowing the rest.
 *
 * Sections:
 *
 *   1. **App data folder** — the resolved `app_data_dir()` path
 *      plus an "Open" affordance that hands the path off to the
 *      OS file manager. The path is shown verbatim so users can
 *      paste it into a bug report or a `cd` command without
 *      having to navigate Explorer. A one-click "Copy" button sits
 *      next to the path for the same reason.
 *
 * Resolution rules for both:
 *   - `path === ''` + `hasError === false` — bridge returned an
 *     empty string (RPC round-trip still in flight or the Rust
 *     side swallowed an error). The page renders a muted
 *     placeholder so the layout doesn't jump once the path
 *     resolves.
 *   - `hasError === true` — Rust threw (rare; usually a malformed
 *     `tauri.conf.json`). The placeholder gets an error-styled
 *     hint and the "Open" button is disabled so the user doesn't
 *     hand an empty string to the OS file manager.
 */
export function AdvancedPage() {
  const { t } = useTranslation()
  const [appDataDir, setAppDataDir] = useState('')
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    if (!window.launcherAPI) return
    let cancelled = false
    void window.launcherAPI.getAppDataDir().then((path) => {
      if (cancelled) return
      if (!path) {
        setHasError(true)
        return
      }
      setAppDataDir(path)
      setHasError(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handleOpenFolder = useCallback(() => {
    void window.launcherAPI?.openAppDataDir?.()
  }, [])

  const handleCopyPath = useCallback(async () => {
    if (!appDataDir) return
    try {
      await navigator.clipboard.writeText(appDataDir)
      toast.success(t('settings.advanced.copied'))
    } catch (error) {
      toast.error(t('common.error'), {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [appDataDir, t])

  return (
    <div className="flex flex-col gap-6 py-6">
      <header>
        <h1 className="text-2xl font-bold">{t('settings.advanced.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('settings.advanced.description')}
        </p>
      </header>

      <Separator />

      <section className="flex flex-col gap-4">
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <Folder className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">
              {t('settings.advanced.appDataLabel')}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('settings.advanced.appDataDescription')}
          </p>

          <div className="mt-4 rounded-md border border-border bg-muted/40 p-3">
            <p
              className="break-all font-mono text-xs text-muted-foreground"
              // `select-all` on click lets the user fall back to
              // manual selection if the clipboard write is blocked
              // by browser permissions — same affordance as the
              // auth-key reveal.
              onClick={(event) => {
                const target = event.currentTarget
                const range = document.createRange()
                range.selectNodeContents(target)
                const selection = window.getSelection()
                selection?.removeAllRanges()
                selection?.addRange(range)
              }}
            >
              {appDataDir || (hasError
                ? t('settings.advanced.pathUnavailable')
                : t('settings.advanced.pathLoading'))}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleOpenFolder}
              disabled={!appDataDir || hasError}
            >
              <FolderOpen className="size-4" />
              {t('settings.advanced.openFolder')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleCopyPath()}
              disabled={!appDataDir || hasError}
            >
              <ClipboardCopy className="size-4" />
              {t('settings.advanced.copyPath')}
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
