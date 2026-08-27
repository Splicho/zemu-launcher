import { Dialog, DialogClose, DialogContent, DialogDescription } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { useTranslation } from 'react-i18next'

interface DownloadProgressDialogProps {
  /** Controls dialog visibility from the parent. */
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DownloadProgressDialog({
  open,
  onOpenChange,
}: DownloadProgressDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-sm flex flex-col items-center justify-center gap-6 text-center"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        showCloseButton={false}
      >
        <DialogDescription className="sr-only">
          {t('context.downloadProgress')}
        </DialogDescription>

        {/* Visually hidden close button — accessible but not visible. */}
        <DialogClose asChild>
          <button className="sr-only">{t('common.close')}</button>
        </DialogClose>

        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Spinner /> {t('download.connecting')}
        </p>
      </DialogContent>
    </Dialog>
  )
}
