import { useState, useCallback } from 'react'
import { Copy, Check } from 'lucide-react'

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface SteamInstructionsModalProps {
  /** Controls dialog visibility from the parent. */
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Called when the user explicitly dismisses the instructions via the
   * footer button. The parent is responsible for opening Steam via
   * `shell_open_url` and persisting the "seen" flag — this modal
   * intentionally doesn't talk to localStorage or the bridge itself
   * so it stays a pure presentational component.
   */
  onAcknowledge: () => void | Promise<void>
}

const DOWNLOAD_DEPOT_COMMAND =
  'download_depot 433850 433851 6098349229565958949'

const STEAM_CONSOLE_URL = 'steam://open/console'

/**
 * "Download the base game via Steam" instructions modal.
 *
 * Shown on first install (before folder selection) because the launcher
 * no longer bundles the Steam SDK — users need to grab the base game
 * via Steam's depot console, then point the launcher at the resulting
 * folder. After the user clicks the footer button the parent:
 *
 *   1. Writes `steam-instructions-seen` to localStorage so the modal
 *      doesn't reappear on next launch.
 *   2. Calls `shell_open_url('steam://open/console')` to launch Steam
 *      with the console already focused.
 *   3. Switches the primary button label to "Locate PS3 Folder".
 *
 * Dismissing via the X button or Escape key does NOT call
 * `onAcknowledge` — the modal will reappear on next click of Install.
 */
export function SteamInstructionsModal({
  open,
  onOpenChange,
  onAcknowledge,
}: SteamInstructionsModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleAcknowledge = useCallback(async () => {
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      await onAcknowledge()
    } finally {
      setIsSubmitting(false)
    }
  }, [isSubmitting, onAcknowledge])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        `sm:max-w-lg` gives the dialog enough room for the depot command
        to fit on one line. `onPointerDownOutside` is left enabled so the
        user can dismiss with a backdrop click; X / Escape / backdrop all
        skip `onAcknowledge` (no flag written), matching the "show again
        next time" UX the user picked.
      */}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Download the base game</DialogTitle>
          <DialogDescription>
            We are legally not allowed to ship KotK, so you need to download the base game via Steam's depot console.
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-3 text-sm text-popover-foreground">
          <li className="flex gap-3">
            <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
              1
            </span>
            <span>Open Steam on your computer.</span>
          </li>

          <li className="flex gap-3">
            <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
              2
            </span>
            <span>
              Press <Kbd>Win</Kbd> + <Kbd>R</Kbd>, type{' '}
              <Code>{STEAM_CONSOLE_URL}</Code>, then press <Kbd>Enter</Kbd>.
              The Steam Console window will open.
            </span>
          </li>

          <li className="flex gap-3">
            <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
              3
            </span>
            <div className="min-w-0 flex-1">
              In the Steam Console window, run:
              <CopyableCommand command={DOWNLOAD_DEPOT_COMMAND} />
              then press <Kbd>Enter</Kbd>.
            </div>
          </li>

          <li className="flex gap-3">
            <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
              4
            </span>
            <span>
              Wait for the download to finish. The depot lands under{' '}
              <Code>steamapps/content/app_433850/depot_433851/</Code>.
            </span>
          </li>

          <li className="flex gap-3">
            <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
              5
            </span>
            <span>
              You can close Steam once the download finishes.
            </span>
          </li>
        </ol>

        <DialogFooter className="-mx-4 -mb-4 mt-2 sm:justify-end">
          <DialogClose asChild>
            <Button variant="outline" type="button" disabled={isSubmitting} className="rounded-lg">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="gradient"
            onClick={() => {
              void handleAcknowledge()
            }}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Closing...' : 'Got it'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Inline `<kbd>`-styled key badge. Plain `<span>` underneath — we
 * reach for a `kbd` element semantically but style it ourselves so the
 * launcher doesn't pull in a typography plugin.
 */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
      {children}
    </kbd>
  )
}

/**
 * Monospaced inline command chip. Visually distinct from the body text
 * so the long depot command doesn't get lost in the surrounding prose.
 */
function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground break-all">
      {children}
    </code>
  )
}

/**
 * Single-line command row with a Copy button. Renders the command in a
 * monospace block with a trailing ghost button that flips to a check
 * mark for 1.5s after a successful copy. Failures fall back silently —
 * clipboard write can be blocked by permissions / context, and the
 * user can still copy the text by hand.
 */
function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — leave button as-is, user can copy manually */
    }
  }, [command])

  return (
    <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-muted/50 p-2">
      <code className="flex-1 select-all overflow-x-auto whitespace-pre font-mono text-xs text-foreground">
        {command}
      </code>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => {
              void handleCopy()
            }}
            aria-label={copied ? 'Copied' : 'Copy command'}
            className="shrink-0"
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          {copied ? 'Copied' : 'Copy command'}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
