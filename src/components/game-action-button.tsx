import { useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { useGameStateContext } from '@/contexts/game-state-context'
import { Cancel } from '@/components/icons'

interface GameActionButtonProps {
  className?: string
}

const BUTTON_TEXT: Record<string, string> = {
  NEEDS_DESTINATION: 'Install',
  CHECKING_FOR_UPDATE: 'Checking...',
  APPLYING_PATCH: 'Applying Patch...',
  NOT_INSTALLED: 'Install',
  UPDATE_AVAILABLE: 'Start Update',
  DOWNLOADING_UPDATE: 'Updating...',
  CDN_UNAVAILABLE: 'Updating disabled right now',
  LAUNCHING_GAME: 'Launching game...',
  PLAYING: 'Playing',
  UPDATE_COMPLETE: 'Play',
  UP_TO_DATE: 'Play',
  ERROR: 'Retry',
}

export function GameActionButton({ className }: GameActionButtonProps) {
  const {
    state,
    cancelDownload,
    gameDirectory,
    startUpdate,
    selectDirectory,
  } = useGameStateContext()

  const buttonText = useMemo(() => {
    if (state.type === 'DOWNLOADING_UPDATE' && 'updateStatus' in state && state.updateStatus) {
      const progress = state.updateStatus.overallProgress.toFixed(0)
      return `Updating...${progress}%`
    }
    if (state.type === 'APPLYING_PATCH') {
      return 'Applying Patch...'
    }
    return BUTTON_TEXT[state.type] || 'Install'
  }, [state])

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

  const handlePrimaryAction = useCallback(async () => {
    if (state.type === 'NEEDS_DESTINATION') {
      await selectDirectory()
      return
    }
    if (state.type === 'UPDATE_AVAILABLE') {
      startUpdate()
      return
    }
  }, [state.type, selectDirectory, startUpdate])

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

      {state.type === 'NEEDS_DESTINATION' ? (
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
    </div>
  )
}
