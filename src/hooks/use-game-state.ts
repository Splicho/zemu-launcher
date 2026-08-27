import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { toast } from 'sonner'

import { clearSteamInstructionsSeen } from '@/lib/steam-instructions'

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
  | { type: 'LICENSE_REQUIRED' }
  | { type: 'LICENSE_BINDING' }

import type { LicenseStatus } from '@/hooks/use-license'

const DEFAULT_GAME_LAUNCH_STATE: GameLaunchState = {
  isLaunching: false,
  isRunning: false,
}

/**
 * License status is injected rather than read from `useLicense`
 * directly so the two hooks stay composable. The caller (typically
 * `app-sidebar`) wires them together — `useGameState` only consumes
 * the status value, the calling tree owns the actual `useLicense()`
 * instance and its redeems/revalidates.
 *
 * `LicenseStatus` is required (no default) so a missing license gate
 * in the call tree fails the type-check rather than silently letting
 * unbound users download.
 */
export function useGameState(options: { licenseStatus: LicenseStatus }) {
  const { licenseStatus } = options
  const [gameDirectory, setGameDirectory] = useState<string | null>(null)
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
      setUpdateInfo(info)
      setIsInstalled(installed)

      lastCheckedDirectoryRef.current = gameDirectory
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to check for updates'
      lastCheckedDirectoryRef.current = gameDirectory

      // If the CDN is unavailable, allow proceeding with base game installation
      // The patch can be installed later when the CDN is back
      setUpdateInfo({ hasUpdate: true, cdnAvailable: false })
      setIsInstalled(false)
      toast.warning('CDN unavailable', {
        description: `${errorMsg}. You can still download the base game. Patches will be applied when the CDN is back.`,
      })
    } finally {
      isCheckingRef.current = false
      setIsChecking(false)
    }
  }, [gameDirectory, updateInfo])

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
      setError(null)

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
        setTimeout(async () => {
          const installed = await window.gameAPI.isInstalled()
          setIsInstalled(installed)
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
  }, [gameDirectory, checkForUpdates, justCompletedUpdate])

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
      const errorMsg = err instanceof Error ? err.message : 'Failed to select directory'
      setError(errorMsg)
      toast.error('Failed to select directory', { description: errorMsg })
      return null
    }
  }, [])

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
        const errorMsg = err instanceof Error ? err.message : 'Patch application failed'
        setError(errorMsg)
        toast.error('Patch application failed', { description: errorMsg })
        throw err
      }
  }, [gameDirectory])

  const startUpdate = useCallback(async (): Promise<void> => {
    if (!gameDirectory || !window.gameAPI) {
      throw new Error('Game directory is required')
    }

    console.log('[useGameState] startUpdate called, gameDirectory:', gameDirectory)
    setIsUpdating(true)
    setUpdateStatus(null)
    setError(null)
    setJustCompletedUpdate(false)

    try {
      console.log('[useGameState] Calling window.gameAPI.downloadUpdate...')
      toast.info('Starting update download...')
      const result = await window.gameAPI.downloadUpdate(gameDirectory)
      console.log('[useGameState] downloadUpdate result:', result)
      toast.info('Update download initiated, waiting for progress...')

      if (!result.success) {
        const error = new Error(result.error || 'Update failed')
        setIsUpdating(false)
        setError(error.message)
        toast.error('Update failed: ' + error.message)
        throw error
      }
      toast.success('Update started successfully')
    } catch (err) {
      console.error('[useGameState] startUpdate error:', err)
      setIsUpdating(false)
      const errorMsg = err instanceof Error ? err.message : 'Update failed'
      setError(errorMsg)
      toast.error('Update failed: ' + errorMsg)
      throw err
    }
  }, [gameDirectory])

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
      toast.success('Game launched!')
    } catch (err) {
      setGameLaunchState(DEFAULT_GAME_LAUNCH_STATE)
      const errorMsg = err instanceof Error ? err.message : 'Failed to launch game'
      setError(errorMsg)
      toast.error('Failed to launch game')
      throw err
    }
  }, [])

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
    // Wiping the install means the user is about to set up the game
    // again — re-arm the Steam instructions modal so they're reminded
    // how to grab the base game via Steam's depot console. This
    // matches the "re-show on explicit clear" UX we picked.
    clearSteamInstructionsSeen()
    hasLoadedRef.current = false
    hasAutoCheckedOnStartupRef.current = false
    lastCheckedDirectoryRef.current = null
  }, [])

  // Derive state
  //
  // Two layers: `baseState` is the original state machine unchanged.
  // `state` overlays the license gate on top — LICENSE_REQUIRED /
  // LICENSE_BINDING short-circuit everything else *except* an in-flight
  // action (downloading, applying, launching, playing) so a license
  // expiry mid-download doesn't yank the carpet out.
  const baseState: GameState = useMemo(() => {
    if (error) {
      return { type: 'ERROR', error }
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
  ])

  const state: GameState = useMemo(() => {
    // In-flight actions take precedence over license gating — we don't
    // want to bounce a user out of an active download because the
    // server briefly failed to validate their key.
    if (
      baseState.type === 'DOWNLOADING_UPDATE' ||
      baseState.type === 'APPLYING_PATCH' ||
      baseState.type === 'LAUNCHING_GAME' ||
      baseState.type === 'PLAYING'
    ) {
      return baseState
    }

    if (licenseStatus === 'binding') {
      return { type: 'LICENSE_BINDING' }
    }
    if (licenseStatus === 'unbound' || licenseStatus === 'other-pc') {
      return { type: 'LICENSE_REQUIRED' }
    }
    return baseState
  }, [baseState, licenseStatus])

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
  }
}
