import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'

import { Button } from '@/components/ui/button'
import { AuthKeyModal } from '@/components/auth-key-modal'
import { useGameStateContext } from '@/hooks/use-game-state-context'
import { Cancel } from '@/components/icons'
import { SteamInstructionsModal } from '@/components/steam-instructions-modal'
import {
  hasSeenSteamInstructions,
  markSteamInstructionsSeen,
} from '@/lib/steam-instructions'

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

  // `hasAcknowledgedSteamInstructions` gates two things:
  //   1. Whether the primary "Install" button routes through the Steam
  //      instructions modal first (false = first-time user, route to
  //      modal; true = returning user, go straight to the picker).
  //   2. The button label on `NEEDS_DESTINATION`: "Install" before
  //      acknowledgement, "Locate PS3 Folder" after — the wording
  //      matches the action the user is actually about to take.
  //
  // We use `useState`'s lazy initializer so the localStorage read
  // happens exactly once, on mount, instead of on every render (which
  // would also risk a stale value if the user clears storage while the
  // page is open — the modal would never reappear).
  const [hasAcknowledgedSteamInstructions, setHasAcknowledgedSteamInstructions] =
    useState<boolean>(hasSeenSteamInstructions)
  const [showSteamModal, setShowSteamModal] = useState(false)

  const buttonText = useMemo(() => {
    if (state.type === 'AUTH_KEY_REQUIRED') {
      return t('play.authKeyRequired')
    }
    if (state.type === 'DOWNLOADING_UPDATE' && 'updateStatus' in state && state.updateStatus) {
      const progress = state.updateStatus.overallProgress.toFixed(0)
      return t('play.updateProgress', { progress })
    }
    if (state.type === 'APPLYING_PATCH') {
      return t('play.applyingPatch')
    }
    if (state.type === 'NEEDS_DESTINATION') {
      return hasAcknowledgedSteamInstructions ? t('play.locatePs3Folder') : t('play.install')
    }
    if (state.type === 'UPDATE_AVAILABLE') {
      return state.reason === 'NOT_INSTALLED' ? t('play.installPatch') : t('play.updateAvailable')
    }
    switch (state.type) {
      case 'CHECKING_FOR_UPDATE':
        return t('play.checking')
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
  }, [state, hasAcknowledgedSteamInstructions, t])

  // `buttonVariant` applies the green glow only when the launcher is
  // ready to actually play — not during all the states that still
  // return "Play" as a label.
  const buttonVariant = useMemo(() => {
    switch (state.type) {
      case 'PLAYING':
      case 'UPDATE_COMPLETE':
      case 'UP_TO_DATE':
        return 'play' as const
      default:
        return 'gradient' as const
    }
  }, [state.type])

  const isDisabled = useMemo(
    () =>
      state.type === 'CHECKING_FOR_UPDATE' ||
      state.type === 'DOWNLOADING_UPDATE' ||
      state.type === 'APPLYING_PATCH' ||
      state.type === 'LAUNCHING_GAME' ||
      state.type === 'PLAYING',
    [state.type]
  )

  const isCancellable =
    state.type === 'DOWNLOADING_UPDATE' ||
    state.type === 'APPLYING_PATCH'

  const handleCancelDownload = useCallback(() => {
    cancelDownload()
  }, [cancelDownload])

  const handleAcknowledgeSteamInstructions = useCallback(async () => {
    // Persist the flag first so a crash mid-handler still leaves the
    // user on the fast path next launch. The flag write is sync + tiny
    // so we don't await it. Then drop the modal and switch the
    // primary button label to "Locate PS3 Folder" — the actual
    // Steam console download is the user's responsibility from this
    // point on.
    markSteamInstructionsSeen()
    setHasAcknowledgedSteamInstructions(true)
    setShowSteamModal(false)
  }, [])

  const handlePrimaryAction = useCallback(async () => {
    if (state.type === 'AUTH_KEY_REQUIRED') {
      // Open the auth key modal so the user can enter and save their key.
      setShowAuthKeyModal(true)
      return
    }
    if (state.type === 'NEEDS_DESTINATION') {
      // First-time install path: route through the Steam instructions
      // modal so the user knows how to grab the base game. Returning
      // users (flag already set) go straight to the folder picker.
      if (!hasAcknowledgedSteamInstructions) {
        setShowSteamModal(true)
        return
      }
      await selectDirectory()
      return
    }
    if (state.type === 'UPDATE_AVAILABLE') {
      // Either the user just located a PS3 folder that has no
      // `version.json` yet (reason: 'NOT_INSTALLED') or the CDN
      // reports a newer version than what's on disk (reason:
      // 'UPDATE_FOUND'). Both paths pull the same download — only the
      // button label differs.
      startUpdate()
      return
    }
    if (state.type === 'UP_TO_DATE' || state.type === 'UPDATE_COMPLETE') {
      // The game is installed and the launcher thinks it's ready to
      // run. Fire the Rust-side launcher, which spawns H1Z1.exe and
      // flips `gameLaunchState` to `isLaunching` -> `isRunning`. The
      // state machine then re-derives to `LAUNCHING_GAME` /
      // `PLAYING`, which disables this button. The `PLAYING` state
      // is unreachable here because the button is already disabled.
      await launchGame()
      return
    }
  }, [
    state.type,
    setShowAuthKeyModal,
    selectDirectory,
    startUpdate,
    launchGame,
    hasAcknowledgedSteamInstructions,
  ])

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-3">
        <Button
          size="lg"
          className={`rounded-lg min-w-[200px] p-6 text-lg px-10 ${className || ''}`}
          variant={buttonVariant}
          onClick={handlePrimaryAction}
          disabled={isDisabled}
        >
          <AnimatePresence mode="wait">
            <motion.span
              key={state.type}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {buttonText}
            </motion.span>
          </AnimatePresence>
        </Button>

        <AnimatePresence>
          {isCancellable ? (
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
                onClick={handleCancelDownload}
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

      {/*
        Once the user has acknowledged the Steam instructions the
        primary button handles both "install for the first time" and
        "I already have the PS3 folder somewhere" — the secondary
        "Locate folder" link would be redundant. Pre-acknowledgement
        we keep it so users with an existing install don't have to
        read Steam console instructions they don't need.
      */}
      {state.type === 'NEEDS_DESTINATION' && !hasAcknowledgedSteamInstructions ? (
        <p className="text-sm text-muted-foreground">
          {t('play.alreadyInstalled')}{' '}
          <button
            type="button"
            onClick={handlePrimaryAction}
            disabled={isDisabled}
            className="text-primary underline underline-offset-4 hover:text-primary/80 disabled:pointer-events-none disabled:opacity-50"
          >
            {t('play.locateFolder')}
          </button>
        </p>
      ) : null}

      <SteamInstructionsModal
        open={showSteamModal}
        onOpenChange={setShowSteamModal}
        onAcknowledge={handleAcknowledgeSteamInstructions}
      />

      <AuthKeyModal
        open={showAuthKeyModal}
        onOpenChange={setShowAuthKeyModal}
        onSaved={() => {
          // Re-read the auth key from disk so the state machine
          // drops the AUTH_KEY_REQUIRED gate and the button label
          // updates to "Play" (or "Install", etc.).
          void refreshAuthKey()
        }}
      />
    </div>
  )
}
