import { useTranslation } from 'react-i18next'
import { HelpCircle, ExternalLink } from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface AuthKeyHelpModalProps {
  /** Controls dialog visibility from the parent. */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Discord server invite URL — opened when the user clicks "Open Discord". */
  discordInviteUrl: string
}

/**
 * "How to get an auth key" instructions modal.
 *
 * Shown from the auth-key step of the onboarding wizard. Walks the
 * user through the four steps required on Discord (join, verify,
 * open #bot-commands, run /authkey) and provides an "Open Discord"
 * button that hands the URL off to the OS via Tauri's opener plugin
 * — the same plugin the rest of the app uses for external links.
 *
 * This modal is purely presentational: it does not persist anything
 * and does not call into the launcher bridge. The parent owns the
 * `open` / `onOpenChange` pair.
 */
export function AuthKeyHelpModal({ open, onOpenChange, discordInviteUrl }: AuthKeyHelpModalProps) {
  const { t } = useTranslation()

  const stepKeys = ['join', 'verify', 'commands', 'authkey'] as const

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HelpCircle className="size-4 text-muted-foreground" />
            {t('onboarding.step1.howTo.title')}
          </DialogTitle>
          <DialogDescription>
            {t('onboarding.step1.howTo.description')}
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-3">
          {stepKeys.map((key, idx) => (
            <li
              key={key}
              className="flex gap-3 rounded-md border border-border bg-card p-3"
            >
              <span
                aria-hidden
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-500 text-xs font-semibold text-white"
              >
                {idx + 1}
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">
                  {t(`onboarding.step1.howTo.steps.${key}.title`)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t(`onboarding.step1.howTo.steps.${key}.description`)}
                </span>
              </div>
            </li>
          ))}
        </ol>

        <DialogFooter>
          <Button
            variant="gradient"
            onClick={() => void openUrl(discordInviteUrl)}
          >
            <ExternalLink className="size-4" />
            {t('onboarding.step1.howTo.openDiscord')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
