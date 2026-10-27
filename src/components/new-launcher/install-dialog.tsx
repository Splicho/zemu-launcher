import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useGameStateContext } from '@/hooks/use-game-state-context'

/**
 * Hardcoded download size shown in the dialog.
 *
 * The real number lives in the pinned depot manifest
 * (`total_uncompressed_size`, ~14 GB) but reaching it needs a Steam
 * session, so it isn't available before the user starts the install.
 * Replace this with the manifest value once the Rust side exposes it.
 */
const DOWNLOAD_SIZE_LABEL = '14 GB'

/**
 * Install destination dialog — new launcher UI.
 *
 * Phase 1 of the installation plan (see `C:\ZEmu\plan.md`): the game
 * button owns the install, so the only modal in the flow is this one —
 * where the game goes. Everything after Install is reported in the
 * footer (stage word on the button, percentage on the progress bar).
 *
 * Behaviour:
 * - Pre-selects `gameAPI.getDefaultInstallDirectory()` —
 *   `<SystemDrive>\Games\ZEmu`, resolved in Rust. Existing configured
 *   directories are never migrated; this dialog only opens when none is
 *   set (or when the user explicitly re-opens it).
 * - **Change** uses `pickFolder`, which does *not* persist anything, so
 *   cancelling the dialog leaves the config untouched. Install commits
 *   the path through `setDestination()` and the state machine re-derives
 *   from there.
 * - Size rows: free space is real (`game_get_free_space`); the download
 *   size is a hardcoded estimate (`DOWNLOAD_SIZE_LABEL`) until the pinned
 *   depot manifest's `total_uncompressed_size` is surfaced to the renderer.
 */
export function InstallDialog({
  open,
  onOpenChange,
  onInstalled,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after the destination is committed, so the caller can kick
   *  off the client download (phase 2). */
  onInstalled?: (path: string) => void
}) {
  const { t } = useTranslation()
  const { setDestination, selectDirectory } = useGameStateContext()
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [freeBytes, setFreeBytes] = useState<number | null>(null)

  // Seed the default destination the first time the dialog opens.
  useEffect(() => {
    if (!open || path) return
    let cancelled = false

    void window.gameAPI
      ?.getDefaultInstallDirectory?.()
      .then((dir) => {
        if (!cancelled && dir) setPath(dir)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [open, path])

  const handleChange = async () => {
    const picked = await window.gameAPI?.pickFolder?.(path || undefined)
    if (picked) setPath(picked)
  }

  // Free space for the destination's volume. Debounced so dragging through
  // folders in the picker doesn't hammer the IPC; the Rust side walks up to
  // the nearest existing ancestor, so a not-yet-created folder still works.
  useEffect(() => {
    if (!open || !path.trim()) return
    let cancelled = false
    const id = window.setTimeout(() => {
      void window.gameAPI
        ?.getFreeSpace?.(path)
        .then((bytes) => {
          if (!cancelled) setFreeBytes(bytes ?? null)
        })
        .catch(() => {
          if (!cancelled) setFreeBytes(null)
        })
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [open, path])

  const handleInstall = async () => {
    if (!path.trim() || busy) return
    setBusy(true)
    const applied = await setDestination(path)
    setBusy(false)
    if (!applied) return
    onInstalled?.(path.trim())
    onOpenChange(false)
  }

  // Existing install elsewhere: `selectDirectory()` opens the picker and
  // already persists the choice, which is exactly the intent here. The
  // base-build check afterwards is advisory — a mismatch warns instead of
  // blocking, because the fingerprint only exists for folders the launcher
  // downloaded itself.
  const handleLocateExisting = async () => {
    if (busy) return
    const selected = await selectDirectory()
    if (!selected) return
    onOpenChange(false)

    try {
      const check = await window.gameAPI?.checkBaseBuild?.(selected)
      if (check?.status === 'mismatch') {
        toast.warning(t('installDialog.buildMismatchTitle'), {
          description: t('installDialog.buildMismatch'),
        })
      }
    } catch {
      // Advisory only.
    }
  }

  const freeLabel =
    freeBytes === null ? null : `${(freeBytes / 1024 ** 3).toFixed(0)} GB`
  // Under 20 GB the download is likely to fail; flag it early rather than
  // halfway through the depot stage.
  const lowSpace = freeBytes !== null && freeBytes < 20 * 1024 ** 3

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('installDialog.title')}</DialogTitle>
          <DialogDescription>{t('installDialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 py-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
            {t('installDialog.location')}
          </span>
          <div className="flex items-center gap-2">
            <div
              className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-xs text-foreground"
              title={path}
            >
              {path || t('installDialog.locationLoading')}
            </div>
            <Button type="button" variant="outline" onClick={() => void handleChange()}>
              {t('installDialog.change')}
            </Button>
          </div>
          {/* Free space and download size share one muted line; the
              separator only appears when the free-space probe answered. */}
          <div className="flex items-center gap-2 text-xs">
            {freeLabel ? (
              <>
                <span className={lowSpace ? 'text-destructive' : 'text-muted-foreground'}>
                  {t('installDialog.freeSpace')}: {freeLabel}
                </span>
                <span aria-hidden="true" className="text-muted-foreground/50">
                  |
                </span>
              </>
            ) : null}
            <span className="text-muted-foreground">
              {t('installDialog.downloadSize', { size: DOWNLOAD_SIZE_LABEL })}
            </span>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="link"
            size="sm"
            className="px-0"
            onClick={() => void handleLocateExisting()}
          >
            {t('installDialog.locateExisting')}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={() => void handleInstall()} disabled={!path.trim() || busy}>
              {t('installDialog.install')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
