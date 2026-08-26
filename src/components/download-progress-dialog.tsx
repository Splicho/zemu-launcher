import { Dialog, DialogClose, DialogContent, DialogDescription } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'

interface DownloadProgressDialogProps {
  /** Controls dialog visibility from the parent. */
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DownloadProgressDialog({
  open,
  onOpenChange,
}: DownloadProgressDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-sm flex flex-col items-center justify-center gap-6 text-center"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        showCloseButton={false}
      >
        <DialogDescription className="sr-only">
          Download progress
        </DialogDescription>

        {/* Visually hidden close button — accessible but not visible. */}
        <DialogClose asChild>
          <button className="sr-only">Close</button>
        </DialogClose>

        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Spinner /> Connecting...
        </p>
      </DialogContent>
    </Dialog>
  )
}
