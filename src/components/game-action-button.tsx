import { useCallback, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

import { Button } from '@/components/ui/button'
import { useGameStateContext } from '@/contexts/game-state-context'
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
  const {
    state,
    cancelDownload,
    startUpdate,
    selectDirectory,
  } = useGameStateContext()

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
    if (state.type === 'DOWNLOADING_UPDATE' && 'updateStatus' in state && state.updateStatus) {
      const progress = state.updateStatus.overallProgress.toFixed(0)
      return `Updating...${progress}%`
    }
    if (state.type === 'APPLYING_PATCH') {
      return 'Applying Patch...'
    }
    if (state.type === 'NEEDS_DESTINATION') {
      return hasAcknowledgedSteamInstructions ? 'Locate PS3 Folder' : 'Install'
    }
    if (state.type === 'UPDATE_AVAILABLE') {
      return state.reason === 'NOT_INSTALLED' ? 'Install Patch' : 'Update available'
    }
    switch (state.type) {
      case 'CHECKING_FOR_UPDATE':
        return 'Checking...'
      case 'LAUNCHING_GAME':
        return 'Launching game...'
      case 'PLAYING':
        return 'Playing'
      case 'UPDATE_COMPLETE':
      case 'UP_TO_DATE':
        return 'Play'
      case 'ERROR':
        return 'Retry'
      default:
        return 'Install'
    }
  }, [state, hasAcknowledgedSteamInstructions])

  const isDisabled = useMemo(
    () =>
      state.type === 'CHECKING_FOR_UPDATE' ||
      state.type === 'DOWNLOADING_UPDATE' ||
      state.type === 'APPLYING_PATCH' ||
      state.type === 'LAUNCHING_GAME' ||
      state.type === 'PLAYING' ||
      state.type === 'CDN_UNAVAILABLE',
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
  }, [state.type, selectDirectory, startUpdate, hasAcknowledgedSteamInstructions])

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-3">
        <Button
          size="lg"
          className={`rounded-lg min-w-[200px] p-6 text-lg px-10 ${className || ''}`}
          variant="gradient"
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
                aria-label="Cancel download"
                title="Cancel download"
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
          Already installed?{' '}
          <button
            type="button"
            onClick={handlePrimaryAction}
            disabled={isDisabled}
            className="text-primary underline underline-offset-4 hover:text-primary/80 disabled:pointer-events-none disabled:opacity-50"
          >
            Locate folder
          </button>
        </p>
      ) : null}

      <SteamInstructionsModal
        open={showSteamModal}
        onOpenChange={setShowSteamModal}
        onAcknowledge={handleAcknowledgeSteamInstructions}
      />
    </div>
  )
}
