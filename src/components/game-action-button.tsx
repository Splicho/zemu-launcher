import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'

import { Button } from '@/components/ui/button'
import { AuthKeyModal } from '@/components/auth-key-modal'
import { useGameStateContext } from '@/hooks/use-game-state-context'
import { Cancel } from '@/components/icons'
import type { UpdateInfo, UpdateStatus } from '@/hooks/use-game-state'

// Re-stated union shape so TS can narrow inside the switch without
// having to import the discriminated union globally (which would
// pull in the hook itself and cause dependency cycles).
type _LocalGameStateForNarrowing =
  | { type: 'NEEDS_DESTINATION' }
  | { type: 'CHECKING_FOR_UPDATE' }
  | { type: 'APPLYING_PATCH' }
  | {
      type: 'UPDATE_AVAILABLE'
      updateInfo: UpdateInfo
      reason: 'NOT_INSTALLED' | 'UPDATE_FOUND'
    }
  | { type: 'DOWNLOADING_UPDATE'; updateStatus: UpdateStatus }
  | { type: 'CDN_UNAVAILABLE' }
  | { type: 'LAUNCHING_GAME' }
  | { type: 'PLAYING' }
  | { type: 'UPDATE_COMPLETE' }
  | { type: 'UP_TO_DATE' }
  | { type: 'ERROR'; error: string }
  | { type: 'AUTH_KEY_REQUIRED' }

/**
 * Slim two-state Play button. Maps the rich `GameState` union onto
 * three stable visual states:
 *
 *   1. **Pre-play**: install, locate folder, update available, or
 *      auth-key required. The button label tells the user what the
 *      next action is; the click routes through the appropriate
 *      handler.
 *   2. **Updating… N%**: download in flight. Button is disabled,
 *      cancel button visible to its right.
 *   3. **Launching… / Playing…**: game is launching or running.
 *      Button is disabled.
 *
 * Anything that resolves to an error renders as a retry button.
 *
 * The wizard now owns the first-time install UX (Steam instructions
 * modal, etc.), so this component no longer reaches for that flow.
 * Users mid-wizard never land here — `AuthedApp` routes them to
 * `/onboarding` first.
 */

interface GameActionButtonProps {
  className?: string
}

export function GameActionButton({ className }: GameActionButtonProps) {
  const { t } = useTranslation()
  const {
    state,
    cancelDownload,
    launchGame,
    startUpdate,
    selectDirectory,
    refreshAuthKey,
  } = useGameStateContext()

  const [showAuthKeyModal, setShowAuthKeyModal] = useState(false)

  // Cast `state` to a local union so the switch narrows correctly
  // for `state.updateStatus`, `state.reason`, etc. without TS losing
  // the discriminant (which it does when you stash `state.type` in a
  // separate const).
  const localState = state as _LocalGameStateForNarrowing
  const type = localState.type
  const label = useMemo<string>(() => {
    switch (type) {
      case 'AUTH_KEY_REQUIRED':
        return t('play.authKeyRequired')
      case 'NEEDS_DESTINATION':
        return t('play.locatePs3Folder')
      case 'CHECKING_FOR_UPDATE':
        return t('play.checking')
      case 'UPDATE_AVAILABLE':
        return localState.reason === 'NOT_INSTALLED' ? t('play.installPatch') : t('play.updateAvailable')
      case 'DOWNLOADING_UPDATE':
        return t('play.updateProgress', { progress: Math.round(localState.updateStatus.overallProgress) })
      case 'APPLYING_PATCH':
        return t('play.applyingPatch')
      case 'CDN_UNAVAILABLE':
        return t('play.updateAvailable')
      case 'LAUNCHING_GAME':
        return t('play.launchingGame')
      case 'PLAYING':
        return t('play.playing')
      case 'UPDATE_COMPLETE':
      case 'UP_TO_DATE':
        return t('play.play')
      case 'ERROR':
        return t('play.retry')
      default:
        return t('play.install')
    }
  }, [type, localState, t])

  // Green-glow `play` variant only when we're actually ready to launch.
  const variant = useMemo<'gradient' | 'play'>(() => {
    return type === 'UP_TO_DATE' || type === 'UPDATE_COMPLETE' ? 'play' : 'gradient'
  }, [type])

  // Disabled when an action is already in flight or when there's
  // nothing for the user to click (checking, launching, playing,
  // already downloading).
  const disabled = useMemo(() => {
    return (
      type === 'CHECKING_FOR_UPDATE' ||
      type === 'DOWNLOADING_UPDATE' ||
      type === 'APPLYING_PATCH' ||
      type === 'CDN_UNAVAILABLE' ||
      type === 'LAUNCHING_GAME' ||
      type === 'PLAYING'
    )
  }, [type])

  const cancellable = type === 'DOWNLOADING_UPDATE' || type === 'APPLYING_PATCH'

  const handleClick = useCallback(async () => {
    if (type === 'AUTH_KEY_REQUIRED') {
      setShowAuthKeyModal(true)
      return
    }
    if (type === 'NEEDS_DESTINATION') {
      await selectDirectory()
      return
    }
    if (type === 'UPDATE_AVAILABLE') {
      startUpdate()
      return
    }
    if (type === 'UP_TO_DATE' || type === 'UPDATE_COMPLETE') {
      await launchGame()
      return
    }
    if (type === 'ERROR') {
      window.dispatchEvent(new CustomEvent('zemu:game-retry'))
      return
    }
  }, [type, selectDirectory, startUpdate, launchGame])

  const handleCancel = useCallback(() => {
    cancelDownload()
  }, [cancelDownload])

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-3">
        <Button
          size="lg"
          className={`min-w-[200px] rounded-lg px-10 p-6 text-lg ${className || ''}`}
          variant={variant}
          onClick={() => void handleClick()}
          disabled={disabled}
        >
          <AnimatePresence mode="wait">
            <motion.span
              key={type}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              {label}
            </motion.span>
          </AnimatePresence>
        </Button>

        <AnimatePresence>
          {cancellable ? (
            <motion.div
              key="cancel"
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.15 }}
            >
              <Button
                size="icon-lg"
                variant="destructive"
                onClick={handleCancel}
                aria-label={t('play.cancelDownload')}
                title={t('play.cancelDownload')}
                className="size-12 rounded-lg"
              >
                <Cancel className="size-5" />
              </Button>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <AuthKeyModal
        open={showAuthKeyModal}
        onOpenChange={setShowAuthKeyModal}
        onSaved={() => {
          // Re-read the auth key from disk so the state machine
          // drops the AUTH_KEY_REQUIRED gate.
          void refreshAuthKey()
        }}
      />
    </div>
  )
}
