import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export interface GameLaunchState {
  isLaunching: boolean
  isRunning: boolean
}

export interface UpdateStatus {
  isUpdating: boolean
  currentFolder?: string
  currentFile?: string
  totalFolders: number
  completedFolders: number
  totalFiles: number
  completedFiles: number
  overallProgress: number
  folders: Array<{
    folderName: string
    stage: 'downloading' | 'decompressing' | 'extracting' | 'complete'
    progress: number
    downloaded: number
    total: number
    speed?: number
  }>
  files?: Array<{
    filePath: string
    stage: 'downloading' | 'decompressing' | 'extracting' | 'complete'
    progress: number
    downloaded: number
    total: number
    speed?: number
  }>
  error?: string
}

export interface FileManifestEntry {
  checksum: string
  size: number
  compressedSize: number
  path: string
}

export interface UpdateInfo {
  hasUpdate: boolean
  cdnAvailable: boolean
  currentVersion?: string
  latestVersion?: string
  foldersToUpdate?: string[]
  filesToUpdate?: Array<{ folderName: string; filePath: string; entry: FileManifestEntry }>
  isFileLevel?: boolean
}

export type GameState =
  | { type: 'NEEDS_DESTINATION' }
  | { type: 'CHECKING_FOR_UPDATE' }
  | { type: 'APPLYING_PATCH' }
  | { type: 'UPDATE_AVAILABLE'; updateInfo: UpdateInfo; reason: 'NOT_INSTALLED' | 'UPDATE_FOUND' }
  | { type: 'DOWNLOADING_UPDATE'; updateStatus: UpdateStatus }
  | { type: 'CDN_UNAVAILABLE' }
  | { type: 'LAUNCHING_GAME' }
  | { type: 'PLAYING' }
  | { type: 'UPDATE_COMPLETE' }
  | { type: 'UP_TO_DATE' }
  | { type: 'ERROR'; error: string }
  | { type: 'AUTH_KEY_REQUIRED' }

const DEFAULT_GAME_LAUNCH_STATE: GameLaunchState = {
  isLaunching: false,
  isRunning: false,
}

/**
 * Hook that drives the game-state state machine.
 *
 * The license gate has been removed as part of the auth key rework.
 * The `AUTH_KEY_REQUIRED` state replaces it: when the user has not
 * yet saved an auth key, the primary button shows "Auth Key Required"
 * and opens the auth key modal on click. The gate is purely local —
 * no server validation is performed. */
export function useGameState() {
  const { t } = useTranslation()
  const [gameDirectory, setGameDirectory] = useState<string | null>(null)
  // `null` while we haven't loaded yet (treat as not-required until
  // we know — avoids a "flash" of the AUTH_KEY_REQUIRED state on
  // every mount while the IPC round-trip is in flight). The state
  // machine below maps `null` to a no-op gate, so the user only
  // sees AUTH_KEY_REQUIRED once the disk read confirms the key is
  // genuinely missing.
  const [authKey, setAuthKey] = useState<string | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [isApplyingPatch, setIsApplyingPatch] = useState(false)
  const [gameLaunchState, setGameLaunchState] = useState<GameLaunchState>(DEFAULT_GAME_LAUNCH_STATE)
  const [error, setError] = useState<string | null>(null)
  const [justCompletedUpdate, setJustCompletedUpdate] = useState(false)

  const isLoadingRef = useRef(false)
  const hasLoadedRef = useRef(false)
  const updateListenerRef = useRef<(() => void) | null>(null)
  const launchStateListenerRef = useRef<(() => void) | null>(null)
  const isCheckingRef = useRef(false)
  const lastCheckedDirectoryRef = useRef<string | null>(null)
  const hasAutoCheckedOnStartupRef = useRef(false)
  // Mirror of `justCompletedUpdate` so the `checkForUpdates` callback
  // (whose own deps would otherwise have to include the state setter)
  // can read the latest "we just finished" flag without rebuilding.
  const justCompletedUpdateRef = useRef(false)
  // Synchronous re-entry guard for `startUpdate`. `isUpdating` is
  // a React state value, so it does not flip to `true` until the
  // next render — a rapid double-click on the "Update available"
  // button can fire `startUpdate` twice before the second click
  // sees the disabled state, which then bounces on the Rust side
  // with an "Update is already running" error. This ref is set
  // synchronously on entry and cleared on terminal success/error,
  // so the second click no-ops cleanly with no toast spam.
  const startUpdateInFlightRef = useRef(false)
  // Dedupes the error toasts fired from `handleProgress`. Without
  // this, a single Rust-side error string would re-toast on every
  // subsequent progress event (download errors fire many emits per
  // second), drowning the UI. Cleared when Rust emits a clean
  // (`error: null`) status.
  const lastErrorRef = useRef<string | null>(null)

  // Keep the ref in sync with the state so any async callback
  // (notably `checkForUpdates`) sees the latest value without us
  // having to thread it through deps or close over a stale setter.
  useEffect(() => {
    justCompletedUpdateRef.current = justCompletedUpdate
  }, [justCompletedUpdate])

  // Load initial state on mount
  useEffect(() => {
    if (isLoadingRef.current || hasLoadedRef.current) return

    isLoadingRef.current = true
    hasLoadedRef.current = true

    const loadState = async () => {
      try {
        if (!window.gameAPI) {
          setTimeout(loadState, 100)
          return
        }

        const directory = await window.gameAPI.getDirectory()
        setGameDirectory(directory)

        if (directory) {
          const installed = await window.gameAPI.isInstalled()
          setIsInstalled(installed)
        }

        // Read the saved auth key (if any) so the state machine can
        // decide whether to gate the Play button on
        // AUTH_KEY_REQUIRED. A network round-trip is unnecessary —
        // the value is local to this machine.
        if (window.launcherAPI?.getAuthKey) {
          try {
            const savedKey = await window.launcherAPI.getAuthKey()
            // Map Rust's `Option::None` ("no key saved") to `''`
            // so the gate fires; keep `null` reserved for the
            // brief loading window before this read completes.
            setAuthKey(savedKey ?? '')
          } catch {
            // Leave `authKey` at `null` so we fall through rather
            // than incorrectly gating on a failed read.
            setAuthKey(null)
          }
        }
      } catch {
        setGameDirectory(null)
        setIsInstalled(false)
      } finally {
        isLoadingRef.current = false
      }
    }

    loadState()
  }, [])

  useEffect(() => {
    let disposed = false
    let retryTimeoutId: ReturnType<typeof setTimeout> | null = null

    const attachLaunchState = async () => {
      if (!window.gameAPI) {
        retryTimeoutId = setTimeout(() => {
          void attachLaunchState()
        }, 100)
        return
      }

      try {
        const initialState = await window.gameAPI.getLaunchState()
        if (!disposed) {
          setGameLaunchState(initialState)
        }
      } catch {
        if (!disposed) {
          setGameLaunchState(DEFAULT_GAME_LAUNCH_STATE)
        }
      }

      if (launchStateListenerRef.current) {
        launchStateListenerRef.current()
        launchStateListenerRef.current = null
      }

      const cleanup = window.gameAPI.onLaunchState((nextState) => {
        setGameLaunchState(nextState)
        if (nextState.isLaunching || nextState.isRunning) {
          setError(null)
        }
      })

      if (cleanup && typeof cleanup === 'function') {
        launchStateListenerRef.current = cleanup
      }
    }

    void attachLaunchState()

    return () => {
      disposed = true
      if (retryTimeoutId) {
        clearTimeout(retryTimeoutId)
      }
      if (launchStateListenerRef.current) {
        launchStateListenerRef.current()
        launchStateListenerRef.current = null
      }
    }
  }, [])

  // Check for updates when directory is set
  const checkForUpdates = useCallback(async (force = false) => {
    if (!gameDirectory || !window.gameAPI) {
      return
    }

    if (isCheckingRef.current) {
      return
    }

    if (!force && lastCheckedDirectoryRef.current === gameDirectory && updateInfo !== null) {
      return
    }

    isCheckingRef.current = true
    setIsChecking(true)
    setError(null)

    try {
      // Run both reads in parallel and commit state atomically: setting
      // `updateInfo` before `isInstalled` (or vice versa) creates a
      // window where the state machine resolves to `NOT_INSTALLED`
      // ("Install") with `hasUpdate: true` — flashing the wrong label
      // for a frame, or sticking there if the second read is slow.
      const [info, installed] = await Promise.all([
        window.gameAPI.checkUpdate(),
        window.gameAPI.isInstalled(),
      ])

      // If an update just completed, the Rust side may briefly report
      // stale values while it catches up to the new on-disk state.
      // Trust the optimistic clear from the progress handler — writing
      // back `hasUpdate: true` here is what traps the user on the
      // "Update available" button until they restart the launcher.
      if (!justCompletedUpdateRef.current) {
        setUpdateInfo(info)
        setIsInstalled(installed)
      }

      lastCheckedDirectoryRef.current = gameDirectory
    } catch (err) {
      // Same reasoning as the success path: a just-completed update
      // means we already know the install is good and up to date.
      // Don't clobber it back to "needs install / has update" — that
      // is exactly the bug that traps users on the wrong button.
      if (!justCompletedUpdateRef.current) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to check for updates'
        lastCheckedDirectoryRef.current = gameDirectory

        // If the CDN is unavailable, allow proceeding with base game installation
        // The patch can be installed later when the CDN is back
        setUpdateInfo({ hasUpdate: true, cdnAvailable: false })
        setIsInstalled(false)
        toast.warning(t('toasts.cdnUnavailable'), {
          description: t('toasts.cdnUnavailableDescription', { error: errorMsg }),
        })
      }
    } finally {
      isCheckingRef.current = false
      setIsChecking(false)
    }
  }, [gameDirectory, updateInfo, t])

  // Auto-check when directory is set
  useEffect(() => {
    if (!gameDirectory) {
      setUpdateInfo(null)
      setIsInstalled(false)
      lastCheckedDirectoryRef.current = null
      hasAutoCheckedOnStartupRef.current = false
      return
    }

    const shouldForceStartupCheck = !hasAutoCheckedOnStartupRef.current
    if (shouldForceStartupCheck) {
      hasAutoCheckedOnStartupRef.current = true
      const timeoutId = setTimeout(() => {
        void checkForUpdates(true)
      }, 100)

      return () => clearTimeout(timeoutId)
    }

    if (lastCheckedDirectoryRef.current === gameDirectory && updateInfo !== null) {
      return
    }

    const timeoutId = setTimeout(() => {
      void checkForUpdates()
    }, 100)

    return () => clearTimeout(timeoutId)
  }, [gameDirectory, checkForUpdates, updateInfo])

  // Listen for update progress
  useEffect(() => {
    if (!window.gameAPI) return

    if (updateListenerRef.current) {
      updateListenerRef.current()
      updateListenerRef.current = null
    }

const handleProgress = (status: UpdateStatus) => {
      setUpdateStatus(status)
      setIsUpdating(status.isUpdating)

      // Errors from Rust arrive via the `update-progress` event with
      // `is_updating=false` and `error` populated. The previous code
      // unconditionally cleared the error string here (`setError(null)`)
      // and relied on the toast fired inside `startUpdate`'s catch
      // block — but Rust can emit error events outside of an awaited
      // `startUpdate` call (e.g. cancellation, or an error that
      // surfaces from inside a spawned task), in which case no toast
      // ever fires and the user just sees the button re-enable with
      // no explanation. Surface the error ourselves here, deduped via
      // `lastErrorRef` so the same message doesn't spam toasts on
      // every subsequent progress event.
      if (status.error) {
        const previousError = lastErrorRef.current
        if (previousError !== status.error) {
          lastErrorRef.current = status.error
          setError(status.error)
          toast.error(t('toasts.updateFailed', { error: status.error }))
        }
      } else {
        setError(null)
        lastErrorRef.current = null
      }

      const hasUpdates =
        status.totalFolders > 0 || (status.totalFiles && status.totalFiles > 0)
      if (!status.isUpdating && status.overallProgress === 100 && gameDirectory && hasUpdates) {
        // Patch just finished. The Rust side has written `version.json`
        // for the new install, so we can confidently mark the game as
        // installed *now* — no need to wait for the 500ms isInstalled
        // round-trip. Without this, the state machine's CDN_UNAVAILABLE
        // branch can win during the gap when `cdnAvailable` is false,
        // trapping the user on "Updating disabled right now" instead of
        // landing them on "Play".
        setJustCompletedUpdate(true)
        setIsInstalled(true)
        setUpdateInfo((prev) =>
          prev ? { ...prev, hasUpdate: false } : { hasUpdate: false, cdnAvailable: true }
        )
        // Schedule a deferred re-check so `version.json` on disk and
        // any cloud-side state get re-read. We guard both writes with
        // `justCompletedUpdateRef.current` because Rust may still be
        // finishing the `version.json` write when this fires — if we
        // trust its `isInstalled()` reply unconditionally, a transient
        // `false` here flips the state machine back to `NOT_INSTALLED`
        // and traps the user on the "Install" button until they
        // refresh the launcher. Optimistic state stays authoritative
        // until the user starts a new update cycle (which resets
        // `justCompletedUpdate` to `false`).
        setTimeout(async () => {
          if (!justCompletedUpdateRef.current) {
            return
          }
          const installed = await window.gameAPI.isInstalled()
          if (justCompletedUpdateRef.current) {
            setIsInstalled(installed || true)
          }
          await checkForUpdates(true)
        }, 500)
      } else if (!status.isUpdating && !hasUpdates && !justCompletedUpdate) {
        setIsUpdating(false)
        setTimeout(() => {
          checkForUpdates()
        }, 100)
      }
    }

    const cleanup = window.gameAPI.onUpdateProgress(handleProgress)
    if (cleanup && typeof cleanup === 'function') {
      updateListenerRef.current = cleanup
    }

    return () => {
      if (updateListenerRef.current) {
        updateListenerRef.current()
        updateListenerRef.current = null
      }
    }
  }, [gameDirectory, checkForUpdates, justCompletedUpdate, t])

  const selectDirectory = useCallback(async (): Promise<string | null> => {
    if (!window.gameAPI) return null

    try {
      const selected = await window.gameAPI.selectDirectory()
      if (selected) {
        // Clear the previous folder's `updateInfo` before swapping the
        // directory so the state machine resolves to `CHECKING_FOR_UPDATE`
        // (label: "Checking...") instead of flashing `NOT_INSTALLED` /
        // "Install" with stale `hasUpdate: true` from the old folder.
        // The effect on `gameDirectory` change schedules a fresh check
        // ~100ms later which will populate the new info.
        setUpdateInfo(null)
        setGameDirectory(selected)
        setError(null)
        hasAutoCheckedOnStartupRef.current = false
        lastCheckedDirectoryRef.current = null
        const installed = await window.gameAPI.isInstalled()
        setIsInstalled(installed)
        return selected
      }
      return null
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : t('toasts.failedToSelectDirectory')
      setError(errorMsg)
      toast.error(t('toasts.failedToSelectDirectory'), { description: errorMsg })
      return null
    }
  }, [t])

  const cancelDownload = useCallback(() => {
    if (!window.gameAPI) return
    window.gameAPI.cancelDownload()
    setIsApplyingPatch(false)
  }, [])

  const applyPatch = useCallback(async (): Promise<void> => {
    if (!gameDirectory || !window.gameAPI) {
      throw new Error('Game directory is required')
    }

    setIsApplyingPatch(true)
    setError(null)

    try {
      const result = await window.gameAPI.downloadUpdate(gameDirectory)

      if (!result.success) {
        throw new Error(result.error || 'Patch application failed')
      }
      } catch (err) {
        setIsApplyingPatch(false)
        const errorMsg = err instanceof Error ? err.message : t('toasts.patchApplicationFailed')
        setError(errorMsg)
        toast.error(t('toasts.patchApplicationFailed'), { description: errorMsg })
        throw err
      }
  }, [gameDirectory, t])

  const startUpdate = useCallback(async (): Promise<void> => {
    if (!gameDirectory || !window.gameAPI) {
      throw new Error('Game directory is required')
    }

    // Synchronous re-entry guard. The `disabled` prop on the button
    // already prevents most double-fires, but `onClick` returns before
    // React re-renders, so a fast double-click can land two
    // `startUpdate` invocations within the same microtask. The second
    // one would otherwise reach Rust, see `is_updating=true`, and
    // bounce with "Update is already running" — surfacing as a
    // confusing toast and looking like the button "didn't register"
    // the click. Bailing silently here matches what the user
    // expects from a disabled button.
    if (startUpdateInFlightRef.current) {
      return
    }
    startUpdateInFlightRef.current = true

    console.log('[useGameState] startUpdate called, gameDirectory:', gameDirectory)
    setIsUpdating(true)
    setUpdateStatus(null)
    setError(null)
    setJustCompletedUpdate(false)
    // Clear the dedupe ref so a retry of the SAME error string still
    // surfaces as a fresh toast — without this, a user retrying after
    // a size-mismatch error would see the button re-enable but no
    // toast, because `lastErrorRef` still holds the previous message.
    lastErrorRef.current = null

    try {
      console.log('[useGameState] Calling window.gameAPI.downloadUpdate...')
      const result = await window.gameAPI.downloadUpdate(gameDirectory)
      console.log('[useGameState] downloadUpdate result:', result)

      if (!result.success) {
        const error = new Error(result.error || 'Update failed')
        setIsUpdating(false)
        setError(error.message)
        toast.error(t('toasts.updateFailed', { error: error.message }))
        throw error
      }
    } catch (err) {
      console.error('[useGameState] startUpdate error:', err)
      setIsUpdating(false)
      const errorMsg = err instanceof Error ? err.message : 'Update failed'
      setError(errorMsg)
      toast.error(t('toasts.updateFailed', { error: errorMsg }))
      throw err
    } finally {
      // Release the synchronous guard regardless of outcome. Errors
      // leave the button enabled (via `setIsUpdating(false)` and the
      // state machine falling out of `DOWNLOADING_UPDATE`), so the
      // user can retry without the guard swallowing their next click.
      startUpdateInFlightRef.current = false
    }
  }, [gameDirectory, t])

  const launchGame = useCallback(async (): Promise<void> => {
    if (!window.gameAPI) {
      throw new Error('gameAPI not available')
    }

    try {
      setJustCompletedUpdate(false)
      setError(null)
      setGameLaunchState({ isLaunching: true, isRunning: false })
      const result = await window.gameAPI.launchGame()
      if (!result || (typeof result === 'object' && !result.success)) {
        throw new Error(
          typeof result === 'object' && result.error ? result.error : 'Failed to launch game'
        )
      }

      const nextState = await window.gameAPI.getLaunchState().catch(() => null)
      if (nextState) {
        setGameLaunchState(nextState)
      }
      toast.success(t('toasts.gameLaunched'))
    } catch (err) {
      setGameLaunchState(DEFAULT_GAME_LAUNCH_STATE)
      const errorMsg = err instanceof Error ? err.message : t('toasts.failedToLaunchGame')
      setError(errorMsg)
      toast.error(t('toasts.failedToLaunchGame'))
      throw err
    }
  }, [t])

  const retryLastStep = useCallback(async (): Promise<void> => {
    setError(null)
    if (gameDirectory) {
      await checkForUpdates(true)
    }
  }, [gameDirectory, checkForUpdates])

  const clearDirectory = useCallback(async (): Promise<void> => {
    if (!window.gameAPI) {
      throw new Error('gameAPI not available')
    }

    await window.gameAPI.clearDirectory()
    setGameDirectory(null)
    setUpdateInfo(null)
    setIsInstalled(false)
    setGameLaunchState(DEFAULT_GAME_LAUNCH_STATE)
    setError(null)
    setJustCompletedUpdate(false)
    // Wiping the install lands the user on the Play page with the
    // `Update` button — they can re-run the onboarding wizard from
    // Settings > General if they want the full guided flow. We no
    // longer re-arm the Steam instructions modal here; the wizard's
    // Step 3 owns that UX now.
    hasLoadedRef.current = false
    hasAutoCheckedOnStartupRef.current = false
    lastCheckedDirectoryRef.current = null
  }, [])

  // Re-read the auth key, install directory, and installed flag from
  // disk and push them into the state machine.
  //
  // Why this exists:
  //
  // The onboarding wizard writes the auth key (Step 1), install
  // folder (Step 2), and Zemu marker (Step 3) **directly** through
  // `window.launcherAPI.*` / `window.gameAPI.*`, bypassing the
  // `useGameState` store. The store's mount effect loads these values
  // exactly once — but it runs *before* the user has typed anything,
  // so the store stays pinned at the empty defaults (no key, no
  // directory) until the user explicitly re-triggers a refresh from
  // the play page.
  //
  // The bug this caused was visible after finishing the wizard: the
  // Play page immediately showed "Auth Key Required" (the store
  // didn't know onboarding had saved a key). Clicking that button
  // opened the Auth Key modal pre-filled with the right value,
  // confirming the key was on disk; saving it cleared the auth-key
  // gate but exposed the next stale value — `gameDirectory` was
  // still empty in the store, so the button flipped to "Locate PS3
  // folder". The fix is to refresh the store at the end of onboarding
  // so the play page sees the same world the wizard just left.
  //
  // The auth-key modal's `onSaved` callback (on the play page) also
  // routes through here for the same reason — when the user re-saves
  // an auth key from the modal, we want the directory / installed
  // flag carried along so a follow-up save doesn't have to refresh
  // two separate fields. Previously this was a separate
  // `refreshAuthKey` that only touched the key, leaving directory
  // writes still stranded.
  const refreshFromDisk = useCallback(async (): Promise<void> => {
    try {
      if (window.launcherAPI?.getAuthKey) {
        const savedKey = await window.launcherAPI.getAuthKey()
        // Map Rust's `Option::None` ("no key saved") to `''` so
        // the auth-key gate fires; keep `null` reserved for the
        // brief loading window before this read completes.
        setAuthKey(savedKey ?? '')
      }
      if (window.gameAPI) {
        const directory = await window.gameAPI.getDirectory()
        setGameDirectory(directory)
        if (directory) {
          const installed = await window.gameAPI.isInstalled()
          setIsInstalled(installed)
          // Force a fresh update check so the play button shows
          // "Install Patch" / "Update Available" against the
          // just-loaded directory rather than the stale
          // `updateInfo` we previously cached for a no-longer-used
          // path.
          hasAutoCheckedOnStartupRef.current = false
          lastCheckedDirectoryRef.current = null
        } else {
          setIsInstalled(false)
        }
      }
    } catch {
      // Swallow — a failed refresh leaves the store at whatever
      // values it already held, which is preferable to a partial
      // reset (e.g. clearing the auth key because the keyring IPC
      // errored) that would put the play page in an unrecoverable
      // "Auth Key Required" loop the user has no path out of.
    }
  }, [])

  // Back-compat alias. The Auth Key modal on the play page used to
  // call `refreshAuthKey` to clear the `AUTH_KEY_REQUIRED` gate;
  // now it should really run the full disk refresh so a re-save
  // doesn't strand the directory. Keep the old name forwarding so
  // the call-site doesn't need a parallel rename.
  const refreshAuthKey = refreshFromDisk

  // Derive state
  //
  // Single-layer derivation: the license gate has been replaced by a
  // local auth-key gate. If no auth key is set, `AUTH_KEY_REQUIRED`
  // short-circuits everything (except `ERROR`, which the user must
  // see immediately, and in-flight actions so a transient state
  // doesn't bounce the user mid-action).
  const baseState: GameState = useMemo(() => {
    if (error) {
      return { type: 'ERROR', error }
    }

    // Auth key gate. We only enforce this once we've read the saved
    // value (`authKey !== null`) — the brief `null` window between
    // mount and the IPC round-trip falls through to the rest of the
    // state machine, so the user never sees a flash of
    // AUTH_KEY_REQUIRED while the launcher is still booting.
    if (
      authKey !== null &&
      authKey.trim() === '' &&
      !gameLaunchState.isLaunching &&
      !gameLaunchState.isRunning &&
      !isApplyingPatch &&
      !(isUpdating && updateStatus && updateStatus.isUpdating)
    ) {
      return { type: 'AUTH_KEY_REQUIRED' }
    }

    if (!gameDirectory || gameDirectory.trim() === '') {
      return { type: 'NEEDS_DESTINATION' }
    }

    if (gameLaunchState.isLaunching) {
      return { type: 'LAUNCHING_GAME' }
    }

    if (gameLaunchState.isRunning) {
      return { type: 'PLAYING' }
    }

    if (isApplyingPatch) {
      return { type: 'APPLYING_PATCH' }
    }

    if (
      (isUpdating || (updateStatus && updateStatus.isUpdating)) &&
      updateStatus &&
      (updateStatus.totalFolders > 0 || updateStatus.totalFiles > 0)
    ) {
      return { type: 'DOWNLOADING_UPDATE', updateStatus }
    }

    if (isChecking) {
      return { type: 'CHECKING_FOR_UPDATE' }
    }

    if (justCompletedUpdate && isInstalled) {
      return { type: 'UPDATE_COMPLETE' }
    }

    // First-time install flow: the user just located a PS3 folder that
    // has files but no `version.json` (which `isInstalled` checks for).
    // Show "Install Patch" — they need the patch applied on top of the
    // existing base game. This is independent of `updateInfo`: even if
    // the CDN check hasn't completed or is stale, the local "no
    // version.json" state is enough to know the patch is needed.
    if (!isInstalled) {
      return {
        type: 'UPDATE_AVAILABLE',
        updateInfo: updateInfo ?? { hasUpdate: true, cdnAvailable: true },
        reason: 'NOT_INSTALLED',
      }
    }

    if (!updateInfo) {
      return { type: 'CHECKING_FOR_UPDATE' }
    }

    if (updateInfo.hasUpdate === true) {
      return { type: 'UPDATE_AVAILABLE', updateInfo, reason: 'UPDATE_FOUND' }
    }

    if (updateInfo.hasUpdate === false) {
      return { type: 'UP_TO_DATE' }
    }

    return { type: 'CHECKING_FOR_UPDATE' }
  }, [
    gameDirectory,
    gameLaunchState,
    isInstalled,
    isUpdating,
    isChecking,
    updateInfo,
    updateStatus,
    error,
    justCompletedUpdate,
    isApplyingPatch,
    authKey,
  ])

  // The license gate has been removed. `baseState` is the canonical
  // derived state with no overlay needed.
  const state = baseState

  return {
    state,
    gameDirectory,
    isInstalled,
    updateInfo,
    updateStatus,
    isChecking,
    isUpdating,
    isApplyingPatch,
    error,
    selectDirectory,
    clearDirectory,
    checkForUpdates,
    startUpdate,
    launchGame,
    cancelDownload,
    applyPatch,
    retryLastStep,
    refreshAuthKey,
    refreshFromDisk,
  }
}
