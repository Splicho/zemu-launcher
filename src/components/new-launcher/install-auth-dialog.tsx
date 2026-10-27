import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * Steam sign-in panel for the client download (phase 2).
 *
 * Shown only when `steam-qr` arrives, i.e. the saved Steam session is
 * absent or rejected — the rule from `C:\ZEmu\plan.md` §5. The QR is a
 * data URL produced by the Rust side, so nothing is fetched here.
 *
 * The pipeline keeps running while this dialog is open: scanning the
 * code closes the QR and moves straight into the depot download. Closing
 * the dialog does not cancel anything, it just hides the code (the
 * footer keeps reporting progress).
 */
export function InstallAuthDialog({
  open,
  qrDataUrl,
  connecting = false,
  accountName,
  error,
  onRetry,
  onOpenChange,
}: {
  open: boolean
  qrDataUrl: string | null
  /** True between the click and the first Steam event (QR not minted yet). */
  connecting?: boolean
  accountName: string | null
  error: string | null
  onRetry: () => void
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('installDialog.signIn')}</DialogTitle>
          <DialogDescription>{t('installDialog.signInDescription')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3 py-2">
          {qrDataUrl ? (
            <div className="rounded-lg bg-white p-3">
              <img
                src={qrDataUrl}
                alt={t('installDialog.signIn')}
                className="size-44"
                draggable={false}
              />
            </div>
          ) : connecting ? (
            // The panel opens as soon as the job starts, so there is a real
            // "waiting for Steam" state before the QR is minted.
            <div className="flex size-44 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border">
              <Spinner className="size-6" />
              <span className="text-xs text-muted-foreground">
                {t('installDialog.connecting')}
              </span>
            </div>
          ) : (
            <div className="grid size-44 place-items-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
              {accountName ?? '…'}
            </div>
          )}

          {error ? (
            <p role="alert" className="text-center text-xs text-destructive">
              {error}
            </p>
          ) : qrDataUrl ? (
            // Only meaningful once a code exists; the connecting state
            // already labels itself inside the placeholder.
            <p className="text-center text-xs text-muted-foreground">
              {accountName ?? t('installDialog.waiting')}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          {error ? (
            <Button type="button" variant="outline" onClick={onRetry}>
              {t('installDialog.retry')}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
