import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { CheckCircle2, Download, Folder, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { TitleBar } from '@/components/title-bar'
import { markOnboardingCompleted } from '@/lib/onboarding'
import type { SetupChecks } from '@/lib/setup-checks'

/**
 * Pre-onboarding prompt: "Do you already have the Pre-Season 3
 * client installed?"
 *
 * Why this exists: the gate (`useOnboardingGate`) treats any missing
 * piece of {key, folder, base game} as "wizard time," which is right
 * for new users but is friction for returning users whose disk has
 * drifted out of sync with the gate's expectations — e.g. the
 * `.zemu-install-v1` marker is missing because the user copied an old
 * PS3 folder by hand, or `H1Z1.exe` is one level deeper than the
 * launcher's marker check looks. Those users still need to reach `/`
 * to launch, not re-walk four wizard steps.
 *
 * Three branches visible to the user:
 *
 *   - "Yes, I do"            — folder already set → one click → flip
 *                               the Rust-side flag, refresh the gate,
 *                               navigate to `#/`. The play page's
 *                               existing auth-key / install toasts
 *                               surface any remaining gap.
 *   - "Yes — let me pick the folder" — no folder set yet (or a
 *                               folder that moved). Opens the OS
 *                               directory picker; if the picked
 *                               folder contains `H1Z1.exe` we treat
 *                               it as a confirmed install and skip
 *                               the wizard. Otherwise we drop them
 *                               into `#/onboarding` with the folder
 *                               pre-filled.
 *   - "No, I need to download" — fresh user with no client. Goes
 *                               straight to `#/onboarding`.
 *
 * `initialChecks` is the `SetupChecks` shape `useOnboardingGate`
 * already produced (we don't re-read disk here). The "Yes" button is
 * always available — a user who knows they have the client but whose
 * folder has moved is the whole point of this screen, and gating the
 * button on the disk check would re-introduce the bug we're trying
 * to fix.
 */
export interface InstallCheckPageProps {
  initialChecks: SetupChecks
  /** Re-evaluate the onboarding gate. Passed through so the "Yes"
   *  branch can publish the now-complete state before the hash flip,
   *  matching the contract the wizard's `finish` callback uses. */
  onRefreshGate?: () => Promise<void>
  /** Navigate to `#/` after the "Yes" branch commits the flag. */
  onSkip?: () => void
}

export function InstallCheckPage({ initialChecks, onRefreshGate, onSkip }: InstallCheckPageProps) {
  const { t } = useTranslation()
  const [isPickingFolder, setIsPickingFolder] = useState(false)
  const [pickError, setPickError] = useState<string | null>(null)

  const skipOnboarding = useCallback(async () => {
    await markOnboardingCompleted()
    await onRefreshGate?.()
    if (typeof window !== 'undefined') {
      window.location.hash = '#/'
    }
    onSkip?.()
  }, [onRefreshGate, onSkip])

  const pickFolderThenSkip = useCallback(async () => {
    if (isPickingFolder) return
    setPickError(null)
    setIsPickingFolder(true)
    try {
      const picked = await window.gameAPI?.selectDirectory?.()
      if (typeof picked !== 'string' || picked.trim().length === 0) {
        // User dismissed the picker without choosing. Stay on this
        // screen rather than dropping them into the wizard — they'd
        // hit the same "pick a folder" prompt in Step 2 anyway, and
        // coming back here is one click away via the wizard's Back.
        return
      }

      // Commit the flag and head to the play page. Whether or not
      // the folder contains `H1Z1.exe`, the user has indicated they
      // have the client — if the play page's install gate lights
      // up next, that's the right next step (install / repair) and
      // not the four-step wizard, which exists to walk a fresh user
      // through setup, not to validate an existing install.
      await skipOnboarding()
    } catch (e) {
      setPickError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsPickingFolder(false)
    }
  }, [isPickingFolder, skipOnboarding])

  const startOnboarding = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.location.hash = '#/onboarding'
    }
  }, [])

  const detected = initialChecks.hasKey && initialChecks.hasFolder && initialChecks.hasBaseGame
  const needsFolderPick = !initialChecks.hasFolder

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden rounded-lg border border-muted bg-background text-foreground">
      <TitleBar />
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-gradient-to-t from-background via-background to-[#121212]">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="relative z-10 mx-auto flex w-full min-w-0 max-w-md flex-col gap-6 p-8"
        >
          <div className="flex flex-col items-center gap-3 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">
              {t('installCheck.title')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('installCheck.description')}
            </p>
          </div>

          {detected ? (
            <div className="flex items-start gap-2 rounded-md border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-600 dark:text-green-400">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{t('installCheck.detectedHint')}</span>
            </div>
          ) : null}

          {pickError ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <span>{pickError}</span>
            </div>
          ) : null}

          <div className="flex flex-col gap-3">
            {needsFolderPick ? (
              <Button
                type="button"
                variant="gradient"
                size="lg"
                onClick={() => void pickFolderThenSkip()}
                disabled={isPickingFolder}
                className="h-12 w-full justify-center rounded-sm"
              >
                {isPickingFolder ? (
                  <Loader2 className="!size-5 animate-spin" />
                ) : (
                  <Folder className="!size-5" />
                )}
                {t('installCheck.chooseFolder')}
              </Button>
            ) : (
              <Button
                type="button"
                variant="gradient"
                size="lg"
                onClick={() => void skipOnboarding()}
                className="h-12 w-full justify-center rounded-sm"
              >
                <CheckCircle2 className="!size-5" />
                {t('installCheck.alreadyInstalled')}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={startOnboarding}
              disabled={isPickingFolder}
              className="h-12 w-full justify-center rounded-sm"
            >
              <Download className="!size-5" />
              {t('installCheck.needToDownload')}
            </Button>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
