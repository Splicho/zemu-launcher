import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { SteamLoginDialog } from '@/components/steam-login-dialog'
import { DownloadProgressDialog } from '@/components/download-progress-dialog'
import { useGameStateContext } from '@/contexts/game-state-context'
import { Cancel } from '@/components/icons'

// Mirror-to-file helper: writes to console AND launcher-debug.log so we can
// debug the Steam login flow without opening DevTools. Provided by
// tauri-bridge.ts on `window.__zemuLog`.
const zLog = (
  msg: string,
  meta?: Record<string, unknown>
): void => {
  const w = window as unknown as {
    __zemuLog?: (tag: string, m: string, x?: unknown) => void
  }
  if (w.__zemuLog) w.__zemuLog('steam.auth', msg, meta)
  else console.log(`[steam.auth] ${msg}`, meta ?? '')
}

interface GameActionButtonProps {
  className?: string
}

const BUTTON_TEXT: Record<string, string> = {
  NEEDS_DESTINATION: 'Install',
  CHECKING_FOR_UPDATE: 'Checking...',
  DOWNLOADING_DEPOT: 'Downloading from Steam...',
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

const H1Z1_MANIFEST_ID = '6098349229565958949'
const H1Z1_DEPOT_ID = '433851'

export function GameActionButton({ className }: GameActionButtonProps) {
  const {
    state,
    downloadDepot,
    cancelDownload,
    saveSteamCredentials,
    steamCredentials,
    gameDirectory,
    depotProgress,
    startUpdate,
    selectDirectory,
  } = useGameStateContext()

  const [loginDialogOpen, setLoginDialogOpen] = useState(false)
  const [loginSubmitting, setLoginSubmitting] = useState(false)
  const [loginRequiresGuard, setLoginRequiresGuard] = useState(false)
  const [loginCanUseMobileApproval, setLoginCanUseMobileApproval] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [pendingUsername, setPendingUsername] = useState<string | null>(null)
  // True while the backend is blocked on Steam's mobile-authenticator push.
  const [awaitingMobileApproval, setAwaitingMobileApproval] = useState(false)
  // Opens the DownloadProgressDialog as soon as the user submits credentials
  // and stays open through Steam auth + ownership check. Closes the moment
  // the actual depot download begins (file_started / chunk_progress).
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false)

  // Auto-close the indicator once the depot download emits its first
  // file-progress event — by that point the main view takes over.
  useEffect(() => {
    if (
      downloadDialogOpen &&
      (depotProgress?.phase === 'file_started' ||
        depotProgress?.phase === 'chunk_progress' ||
        depotProgress?.phase === 'done' ||
        depotProgress?.phase === 'failed' ||
        depotProgress?.phase === 'cancelled')
    ) {
      zLog('depot download started -> close progress dialog')
      setDownloadDialogOpen(false)
    }
  }, [depotProgress?.phase, downloadDialogOpen])

  // Track previous values to detect the false → true transition so the
  // dialog isn't re-opened on every render while login (or the subsequent
  // download, which leaves loginSubmitting=true until `finally`) is in flight.
  const prevLoginSubmittingRef = useRef(false)
  const prevAwaitingRef = useRef(false)

  // Trigger the download dialog when the user submits credentials. The
  // dialog stays open through Steam auth + ownership check + manifest fetch
  // and closes once the first file/chunk event arrives (see the effect
  // above). Fires only on the false → true edge.
  useEffect(() => {
    if (loginSubmitting && !prevLoginSubmittingRef.current) {
      zLog('loginSubmitting -> open download dialog')
      setLoginDialogOpen(false)
      setDownloadDialogOpen(true)
    }
    prevLoginSubmittingRef.current = loginSubmitting
  }, [loginSubmitting])

  // If awaitingMobileApproval flips on (the Steam mobile-app push), make sure
  // the dialog is open even if the parent didn't transition via loginSubmitting.
  useEffect(() => {
    if (awaitingMobileApproval && !prevAwaitingRef.current) {
      zLog('awaitingMobileApproval -> ensure download dialog open')
      setLoginDialogOpen(false)
      setDownloadDialogOpen(true)
    }
    prevAwaitingRef.current = awaitingMobileApproval
  }, [awaitingMobileApproval])

  // Listen for the backend's "waiting on your Steam mobile app" event so the
  // dialog can surface it. Cleared on dialog close / error / success.
  useEffect(() => {
    if (!window.launcherAPI?.onSteamMobileConfirmationPending) {
      zLog('window.launcherAPI.onSteamMobileConfirmationPending not available')
      return
    }

    let unlisten: (() => void) | null = null
    let cancelled = false

    zLog('subscribing to steam-mobile-confirmation-pending event')

    window.launcherAPI
      .onSteamMobileConfirmationPending(() => {
        zLog('event fired -> setAwaitingMobileApproval(true)')
        if (!cancelled) setAwaitingMobileApproval(true)
      })
      .then((cleanup) => {
        zLog('subscription registered')
        if (cancelled) {
          cleanup()
          return
        }
        unlisten = cleanup
      })
      .catch((err) => {
        zLog('subscription failed', { err: String(err) })
        // Bridge unavailable — non-fatal; we just won't show the pill.
      })

    return () => {
      cancelled = true
      if (unlisten) {
        zLog('unsubscribing from steam-mobile-confirmation-pending')
        unlisten()
      }
    }
  }, [])

  const buttonText = useMemo(() => {
    if (state.type === 'DOWNLOADING_DEPOT') {
      return 'Downloading...'
    }
    if (state.type === 'DOWNLOADING_UPDATE' && 'updateStatus' in state && state.updateStatus) {
      const progress = state.updateStatus.overallProgress.toFixed(0)
      return `Updating... (${progress}%)`
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
      state.type === 'DOWNLOADING_DEPOT' ||
      state.type === 'APPLYING_PATCH' ||
      state.type === 'LAUNCHING_GAME' ||
      state.type === 'PLAYING' ||
      state.type === 'CDN_UNAVAILABLE',
    [state.type]
  )

  // The cancel icon only appears during an active download or update. It calls
  // the backend `game_cancel_download` command and clears local download state
  // so the main button immediately becomes interactive again.
  const isCancellable =
    state.type === 'DOWNLOADING_DEPOT' ||
    state.type === 'DOWNLOADING_UPDATE' ||
    state.type === 'APPLYING_PATCH'

  const handleCancelDownload = useCallback(() => {
    zLog('user clicked cancel download', { stateType: state.type })
    cancelDownload()
  }, [cancelDownload, state.type])

  const openLoginDialog = useCallback(() => {
    zLog('openLoginDialog -> reset state, awaitingMobileApproval=false')
    setLoginRequiresGuard(false)
    setLoginCanUseMobileApproval(false)
    setLoginError(null)
    setPendingUsername(null)
    setAwaitingMobileApproval(false)
    setDownloadDialogOpen(false)
    setLoginDialogOpen(true)
  }, [])

  // Trace every state change related to the Steam login flow so we can see
  // which setter fires and in what order from the log file.
  useEffect(() => {
    zLog('state: loginRequiresGuard', { value: loginRequiresGuard })
  }, [loginRequiresGuard])
  useEffect(() => {
    zLog('state: loginCanUseMobileApproval', { value: loginCanUseMobileApproval })
  }, [loginCanUseMobileApproval])
  useEffect(() => {
    zLog('state: awaitingMobileApproval', { value: awaitingMobileApproval })
  }, [awaitingMobileApproval])
  useEffect(() => {
    zLog('state: loginSubmitting', { value: loginSubmitting })
  }, [loginSubmitting])
  useEffect(() => {
    zLog('state: pendingUsername', { value: pendingUsername })
  }, [pendingUsername])
  useEffect(() => {
    zLog('state: loginError', { value: loginError })
  }, [loginError])

  const handleLoginSubmit = useCallback(
    async (input: { username: string; password: string; guardCode: string | null }) => {
      if (!gameDirectory) {
        setLoginError('Pick a destination folder first.')
        return
      }

      setLoginSubmitting(true)
      setLoginError(null)
      setPendingUsername(input.username)
      zLog('loginSteam submitted', { username: input.username, hasGuardCode: Boolean(input.guardCode) })

      try {
        const result = await window.launcherAPI!.loginSteam(
          input.username,
          input.password,
          input.guardCode ?? undefined
        )

        zLog('loginSteam resolved', { status: result.status })

        switch (result.status) {
          case 'needsGuard':
            zLog('result=NeedsGuard', {
              username: result.username,
              canUseMobileApproval: result.canUseMobileApproval,
            })
            setLoginRequiresGuard(true)
            setLoginCanUseMobileApproval(result.canUseMobileApproval ?? false)
            setPendingUsername(result.username)
            break

          case 'authenticated': {
            zLog('result=authenticated -> open download dialog, start depot download')
            const { status: _status, ...creds } = result
            zLog('saving credentials', {
              hasUsername: Boolean(creds.username),
              hasRefreshToken: Boolean(creds.refresh_token),
              steamId: creds.steam_id,
              keys: Object.keys(creds),
            })
            await saveSteamCredentials(creds)
            setAwaitingMobileApproval(false)
            setLoginDialogOpen(false)
            setDownloadDialogOpen(true)
            await downloadDepot(H1Z1_MANIFEST_ID, H1Z1_DEPOT_ID, creds)
            break
          }

          case 'error':
            zLog('result=Error -> awaitingMobileApproval=false', { message: result.message })
            setAwaitingMobileApproval(false)
            setLoginError(result.message)
            break
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Steam sign-in failed'
        zLog('submit threw -> awaitingMobileApproval=false', { message, err: String(err) })
        setAwaitingMobileApproval(false)
        setLoginError(message)
        toast.error('Steam sign-in failed', { description: message })
      } finally {
        setLoginSubmitting(false)
      }
    },
    [downloadDepot, gameDirectory, saveSteamCredentials]
  )

  const handlePrimaryAction = useCallback(async () => {
    // First-time install: no destination folder yet — open the system
    // folder picker, then chain straight into the Steam login dialog once
    // a directory is selected. Cancelling the picker leaves the user on
    // the same screen (state stays NEEDS_DESTINATION).
    if (state.type === 'NEEDS_DESTINATION') {
      zLog('no destination -> open folder picker')
      const picked = await selectDirectory()
      if (picked) {
        zLog('destination selected -> open login dialog')
        openLoginDialog()
      }
      return
    }
    if (state.type === 'UPDATE_AVAILABLE') {
      startUpdate()
      return
    }
    openLoginDialog()
  }, [state.type, selectDirectory, startUpdate, openLoginDialog])

  return (
    <>
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

      <SteamLoginDialog
        open={loginDialogOpen}
        onOpenChange={(next) => {
          if (!next) {
            zLog('dialog closing -> awaitingMobileApproval=false')
            setAwaitingMobileApproval(false)
          }
          setLoginDialogOpen(next)
        }}
        onSubmit={handleLoginSubmit}
        initialUsername={pendingUsername ?? steamCredentials?.username ?? undefined}
        submitting={loginSubmitting}
        requiresGuard={loginRequiresGuard}
        canUseMobileApproval={loginCanUseMobileApproval}
        errorMessage={loginError}
      />

      <DownloadProgressDialog
        open={downloadDialogOpen}
        onOpenChange={setDownloadDialogOpen}
        phase={depotProgress?.phase ?? null}
        awaitingMobileApproval={awaitingMobileApproval}
      />
    </>
  )
}
