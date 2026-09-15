import { useEffect, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Check } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'

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
  const { t } = useTranslation()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const gotItRef = useRef<HTMLButtonElement | null>(null)

  // Detected Steam depot download path. `undefined` while we're
  // checking (or while the modal is closed), `string` when Steam
  // was found, `null` after the detector has finished and confirmed
  // Steam isn't installed.
  //
  // We split the "not yet checked" and "checked, not found" cases so
  // the JSX can render the generic hint immediately (no flash of
  // missing content) and only swap in the concrete path when it
  // arrives. Detection runs locally — registry probe on Windows,
  // path probes elsewhere — and is sub-100ms, but it's still an
  // async invoke so the modal must not block on it.
  const [depotPath, setDepotPath] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    if (!open) {
      // Reset on close so reopening (e.g. after the user installs
      // Steam mid-session) re-detects from scratch.
      setDepotPath(undefined)
      return
    }
    let cancelled = false
    invoke<string | null>('steam_detect_depot_path')
      .then((path) => {
        if (!cancelled) setDepotPath(path)
      })
      .catch(() => {
        // Detection failures are silent — the generic hint covers
        // the user. Don't surface Rust errors to the modal.
        if (!cancelled) setDepotPath(null)
      })
    return () => {
      cancelled = true
    }
  }, [open])

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
        `sm:max-w-xl` (576px) gives the dialog enough room for the
        Steam depot path (`<steam_root>/steamapps/content/...`) to wrap
        cleanly across two lines on a default Windows install path
        while staying narrower than the Properties modal (`max-w-4xl`).
        `onPointerDownOutside` is left enabled so the user can dismiss
        with a backdrop click; X / Escape / backdrop all skip
        `onAcknowledge` (no flag written), matching the "show again
        next time" UX the user picked.
      */}
      <DialogContent
        className="sm:max-w-xl"
        onOpenAutoFocus={(event) => {
          // Radix's default auto-focus lands on the first tabbable
          // descendant, which is the copy-to-clipboard button inside
          // `CopyableCommand`. That fires the tooltip via focus before
          // the user has interacted with anything. Send focus to the
          // primary "Got it" button instead — same a11y outcome (some
          // element inside the dialog receives focus), no surprise
          // tooltip.
          event.preventDefault()
          gotItRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('steamInstructions.downloadBaseGame')}</DialogTitle>
          <DialogDescription>
            {t('steamInstructions.description')}
          </DialogDescription>
        </DialogHeader>

        <SteamInstructionsSteps depotPath={depotPath} />

        <DialogFooter className="-mx-4 -mb-4 mt-2 sm:justify-end">
          <DialogClose asChild>
            <Button variant="outline" type="button" disabled={isSubmitting} className="rounded-lg">
              {t('steamInstructions.cancel')}
            </Button>
          </DialogClose>
          <Button
            ref={gotItRef}
            type="button"
            variant="gradient"
            onClick={() => {
              void handleAcknowledge()
            }}
            disabled={isSubmitting}
          >
            {isSubmitting ? t('steamInstructions.closing') : t('steamInstructions.gotIt')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Reusable ordered list of depot-download steps. Exported so the
 * `Installation Guide` pane inside the Properties dialog can render the
 * same instructions as a read-only reference without duplicating the
 * prose (or the helpers below).
 *
 * `depotPath` is the absolute Steam depot destination folder when the
 * Rust detector has found a Steam install on disk. When `undefined`
 * (still detecting) or `null` (detection finished, no Steam found)
 * we fall back to the relative `steamapps/content/...` hint so the
 * step is never broken. The Properties pane always passes `null`
 * since it shows a static reference copy that doesn't need
 * runtime-detected paths.
 */
export function SteamInstructionsSteps({
  depotPath,
}: {
  /** Steam depot destination path, or null/undefined for the generic hint. */
  depotPath?: string | null
}) {
  const { t } = useTranslation()
  return (
    <ol className="space-y-3 text-sm text-popover-foreground">
      <li className="flex gap-3">
        <StepBadge>1</StepBadge>
        <span>{t('steamInstructions.openSteam')}</span>
      </li>

      <li className="flex gap-3">
        <StepBadge>2</StepBadge>
        <span>
          {t('steamInstructions.step2OpenConsole')}{' '}
          <Kbd>{t('steamInstructions.step2WinR')}</Kbd>,{' '}
          {t('steamInstructions.step2Type')}{' '}
          <Code>{STEAM_CONSOLE_URL}</Code>,{' '}
          {t('steamInstructions.step2PressEnter')}{' '}
          <Kbd>{t('steamInstructions.step2Enter')}</Kbd>.
          {t('steamInstructions.step2ConsoleOpens')}
        </span>
      </li>

      <li className="flex gap-3">
        <StepBadge>3</StepBadge>
        <div className="min-w-0 flex-1 space-y-2">
          {t('steamInstructions.step3RunCommand')}
          <CopyableCommand command={DOWNLOAD_DEPOT_COMMAND} />
          {t('steamInstructions.step3ThenEnter')}{' '}
          <Kbd>{t('steamInstructions.step2Enter')}</Kbd>.
        </div>
      </li>

      <li className="flex gap-3">
        <StepBadge>4</StepBadge>
        <div className="min-w-0 flex-1 space-y-2">
          {t('steamInstructions.step4WaitDownload')}
          {depotPath ? (
            <CopyableCommand command={depotPath} />
          ) : (
            <Code>steamapps/content/app_433850/depot_433851/</Code>
          )}
        </div>
      </li>

      <li className="flex gap-3">
        <StepBadge>5</StepBadge>
        <span>{t('steamInstructions.step5CloseSteam')}</span>
      </li>

      <li className="flex gap-3">
        <StepBadge>6</StepBadge>
        <span>{t('steamInstructions.step6InstallPatch')}</span>
      </li>
    </ol>
  )
}

/**
 * Numbered circle used at the start of each step in the ordered list.
 * Pulled out of the JSX so the markup in `SteamInstructionsSteps`
 * stays focused on the prose.
 */
function StepBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
      {children}
    </span>
  )
}

/**
 * Inline `<kbd>`-styled key badge. Plain `<span>` underneath — we
 * reach for a `kbd` element semantically but style it ourselves so the
 * launcher doesn't pull in a typography plugin.
 */
export function Kbd({ children }: { children: React.ReactNode }) {
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
export function Code({ children }: { children: React.ReactNode }) {
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
export function CopyableCommand({ command }: { command: string }) {
  const { t } = useTranslation()
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
    <div className="mt-2 flex min-w-0 items-center gap-2 rounded-md border border-border bg-muted/50 p-2">
      {/*
        `min-w-0` lets the inner code shrink below its intrinsic
        content width so `overflow-x-auto` actually engages instead
        of the flex row ballooning past the dialog's right edge.
        `whitespace-pre-wrap break-all` is the second layer: the
        code wraps long file paths onto a second line so the user
        can read them in full without horizontal scrolling. For
        short inputs (Step 3's `download_depot 433850 433851`) the
        wrap is a no-op and the line stays single.
      */}
      <code className="min-w-0 flex-1 select-all overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-foreground">
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
            aria-label={copied ? t('steamInstructions.copied') : t('steamInstructions.copyCommand')}
            className="shrink-0"
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          {copied ? t('steamInstructions.copied') : t('steamInstructions.copyCommand')}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
