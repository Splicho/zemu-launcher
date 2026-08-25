import { motion } from 'framer-motion'
import { Dialog, DialogClose, DialogContent, DialogDescription } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'

/**
 * Maps backend depot phases to the 1-liner strings shown in the modal.
 *
 * The dialog is purely an indicator — it shows the spinner + a status
 * phrase during the *setup* phases of a Steam download (auth, ownership
 * check, ownership verified, manifest fetch). Once real file download
 * starts (`file_started` / `chunk_progress`) the dialog auto-closes so
 * the main view's download progress takes over.
 */
function phaseToMessage(phase: string): string | null {
  switch (phase) {
    case 'started':
    case 'logging_in':
      return 'Awaiting Steam authenticator approval...'
    case 'verifying_ownership':
      return 'Checking for game ownership...'
    case 'fetching_manifest':
      return 'Game ownership verified.'
    case 'file_started':
    case 'chunk_progress':
      return 'Initializing download...'
    case 'done':
    case 'failed':
    case 'cancelled':
      return null
    default:
      return phase
  }
}

interface DownloadProgressDialogProps {
  /** Controls dialog visibility from the parent (GameActionButton). */
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Current backend depot phase. Used to pick the 1-liner; null until the
   * backend starts emitting progress events.
   */
  phase: string | null
  /** True while we're still waiting for the Steam mobile-app push. */
  awaitingMobileApproval: boolean
}

export function DownloadProgressDialog({
  open,
  onOpenChange,
  phase,
  awaitingMobileApproval,
}: DownloadProgressDialogProps) {
  // Pick the message. Pre-depot-progress we show the approval message.
  const message = phase == null
    ? (awaitingMobileApproval
      ? 'Awaiting Steam authenticator approval...'
      : 'Connecting to Steam...')
    : (phaseToMessage(phase) ?? 'Initializing download...')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-sm flex flex-col items-center justify-center gap-6 text-center"
        // Prevent closing by clicking the backdrop — the user can't dismiss
        // the indicator; only the backend telling us download started will
        // close it via the parent's onOpenChange(false).
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        showCloseButton={false}
      >
        <DialogDescription className="sr-only">
          Steam download progress
        </DialogDescription>

        {/* Visually hidden close button — accessible but not visible. */}
        <DialogClose asChild>
          <button className="sr-only">Close</button>
        </DialogClose>

        <motion.p
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
          className="text-sm text-muted-foreground flex items-center gap-2"
        >
          <Spinner /> {message}
        </motion.p>
      </DialogContent>
    </Dialog>
  )
}
