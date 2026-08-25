import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import type { SteamCredentials } from '@/lib/tauri-bridge'

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

export type DepotPhase =
  | 'started'
  | 'logging_in'
  | 'verifying_ownership'
  | 'fetching_manifest'
  | 'file_started'
  | 'file_completed'
  | 'chunk_progress'
  | 'done'
  | 'failed'
  | 'cancelled'

export interface DepotProgress {
  phase: DepotPhase
  currentFile?: string
  completedBytes?: number
  totalBytes?: number
  completedFiles?: number
  totalFiles?: number
  percent?: number
  message?: string
  error?: string
}

export type GameState =
  | { type: 'NEEDS_DESTINATION' }
  | { type: 'CHECKING_FOR_UPDATE' }
  | { type: 'DOWNLOADING_DEPOT' }
  | { type: 'APPLYING_PATCH' }
  | { type: 'NOT_INSTALLED' }
  | { type: 'UPDATE_AVAILABLE'; updateInfo: UpdateInfo }
  | { type: 'DOWNLOADING_UPDATE'; updateStatus: UpdateStatus }
  | { type: 'CDN_UNAVAILABLE' }
  | { type: 'LAUNCHING_GAME' }
  | { type: 'PLAYING' }
  | { type: 'UPDATE_COMPLETE' }
  | { type: 'UP_TO_DATE' }
  | { type: 'ERROR'; error: string }

const DEFAULT_GAME_LAUNCH_STATE: GameLaunchState = {
  isLaunching: false,
  isRunning: false,
}

export function useGameState() {
  const [gameDirectory, setGameDirectory] = useState<string | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [isDownloadingDepot, setIsDownloadingDepot] = useState(false)
  const [isApplyingPatch, setIsApplyingPatch] = useState(false)
  const [gameLaunchState, setGameLaunchState] = useState<GameLaunchState>(DEFAULT_GAME_LAUNCH_STATE)
  const [error, setError] = useState<string | null>(null)
  const [justCompletedUpdate, setJustCompletedUpdate] = useState(false)
  const [steamCredentials, setSteamCredentials] = useState<SteamCredentials | null>(null)
  const [depotProgress, setDepotProgress] = useState<DepotProgress | null>(null)

  const isLoadingRef = useRef(false)
  const hasLoadedRef = useRef(false)
  const updateListenerRef = useRef<(() => void) | null>(null)
  const launchStateListenerRef = useRef<(() => void) | null>(null)
  const depotProgressListenerRef = useRef<(() => void) | null>(null)
  const isCheckingRef = useRef(false)
  const lastCheckedDirectoryRef = useRef<string | null>(null)
  const hasAutoCheckedOnStartupRef = useRef(false)
  const pendingAutoPatchRef = useRef(false)

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

        if (window.launcherAPI) {
          try {
            const creds = await window.launcherAPI.getSteamCredentials()
            if (creds) {
              setSteamCredentials(creds)
            }
          } catch {
            // No persisted credentials — user must sign in.
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
      const info = await window.gameAPI.checkUpdate()
      setUpdateInfo(info)

      const installed = await window.gameAPI.isInstalled()
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
        setJustCompletedUpdate(true)
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

  // Listen for Steam depot download progress
  useEffect(() => {
    if (!window.gameAPI || !window.gameAPI.onDepotProgress) return

    if (depotProgressListenerRef.current) {
      depotProgressListenerRef.current()
      depotProgressListenerRef.current = null
    }

    const cleanup = window.gameAPI.onDepotProgress((progress) => {
      setDepotProgress(progress)

      switch (progress.phase) {
        case 'started':
        case 'logging_in':
        case 'verifying_ownership':
        case 'fetching_manifest':
        case 'file_started':
        case 'chunk_progress':
          // In-flight progress — the existing `isDownloadingDepot` flag is
          // enough to keep the sidebar / button busy.
          break

        case 'done':
          setIsDownloadingDepot(false)
          toast.success('Base game downloaded', {
            description: 'Applying Zemu patch...',
          })
          // Auto-trigger patch on successful depot download.
          if (pendingAutoPatchRef.current && window.gameAPI && gameDirectory) {
            pendingAutoPatchRef.current = false
            void window.gameAPI
              .downloadUpdate(gameDirectory)
              .catch((err) => {
                const errorMsg =
                  err instanceof Error ? err.message : 'Patch application failed'
                setError(errorMsg)
                toast.error('Patch application failed', { description: errorMsg })
              })
              .finally(() => {
                setIsApplyingPatch(false)
              })
            setIsApplyingPatch(true)
          }
          break

        case 'failed':
          setIsDownloadingDepot(false)
          pendingAutoPatchRef.current = false
          setError(progress.error || 'Depot download failed')
          toast.error('Depot download failed', {
            description: progress.error || 'See debug log for details.',
          })
          break

        case 'cancelled':
          setIsDownloadingDepot(false)
          pendingAutoPatchRef.current = false
          break

        default:
          break
      }
    })

    if (cleanup && typeof cleanup === 'function') {
      depotProgressListenerRef.current = cleanup
    }

    return () => {
      if (depotProgressListenerRef.current) {
        depotProgressListenerRef.current()
        depotProgressListenerRef.current = null
      }
    }
  }, [gameDirectory])

  const selectDirectory = useCallback(async (): Promise<string | null> => {
    if (!window.gameAPI) return null

    try {
      const selected = await window.gameAPI.selectDirectory()
      if (selected) {
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
    // Optimistically clear local downloading state so the UI responds instantly
    // even if the backend hasn't emitted its terminal status event yet.
    setIsDownloadingDepot(false)
    setIsApplyingPatch(false)
    setDepotProgress(null)
  }, [])

  const downloadDepot = useCallback(
    async (
      manifestId: string,
      depotId: string,
      credentials?: SteamCredentials | null
    ): Promise<void> => {
      if (!gameDirectory || !window.gameAPI) {
        throw new Error('Game directory is required')
      }

      const activeCredentials = credentials ?? steamCredentials
      if (!activeCredentials) {
        throw new Error('Steam credentials required. Sign in via the Steam login dialog.')
      }

      setIsDownloadingDepot(true)
      setDepotProgress(null)
      setError(null)
      pendingAutoPatchRef.current = true

      try {
        const result = await window.gameAPI.downloadDepot(
          manifestId,
          depotId,
          gameDirectory,
          activeCredentials
        )

        if (!result.success) {
          pendingAutoPatchRef.current = false
          setIsDownloadingDepot(false)
          throw new Error(result.error || 'Depot download failed')
        }

        // The backend will rotate the refresh token; re-fetch on completion.
        if (window.launcherAPI) {
          try {
            const refreshed = await window.launcherAPI.getSteamCredentials()
            if (refreshed) setSteamCredentials(refreshed)
          } catch {
            // Ignore — the next launch will refresh naturally.
          }
        }
      } catch (err) {
        pendingAutoPatchRef.current = false
        setIsDownloadingDepot(false)
        const errorMsg = err instanceof Error ? err.message : 'Depot download failed'
        setError(errorMsg)
        toast.error('Depot download failed', { description: errorMsg })
        throw err
      }
    },
    [gameDirectory, steamCredentials]
  )

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
    hasLoadedRef.current = false
    hasAutoCheckedOnStartupRef.current = false
    lastCheckedDirectoryRef.current = null
  }, [])

  const saveSteamCredentials = useCallback(async (credentials: SteamCredentials) => {
    if (!window.launcherAPI) {
      throw new Error('launcherAPI not available')
    }
    await window.launcherAPI.saveSteamCredentials(credentials)
    setSteamCredentials(credentials)
  }, [])

  const clearSteamCredentials = useCallback(async () => {
    if (!window.launcherAPI) return
    await window.launcherAPI.clearSteamCredentials()
    setSteamCredentials(null)
  }, [])

  // Derive state
  const state: GameState = useMemo(() => {
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

    if (isDownloadingDepot) {
      return { type: 'DOWNLOADING_DEPOT' }
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

    if (updateInfo && updateInfo.cdnAvailable === false && !isInstalled) {
      return { type: 'CDN_UNAVAILABLE' }
    }

    if (justCompletedUpdate && isInstalled) {
      return { type: 'UPDATE_COMPLETE' }
    }

    if (!updateInfo) {
      return { type: 'CHECKING_FOR_UPDATE' }
    }

    if (!isInstalled) {
      return { type: 'NOT_INSTALLED' }
    }

    if (updateInfo && updateInfo.hasUpdate === true) {
      return { type: 'UPDATE_AVAILABLE', updateInfo }
    }

    if (updateInfo && updateInfo.hasUpdate === false) {
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
    isDownloadingDepot,
    isApplyingPatch,
  ])

  return {
    state,
    gameDirectory,
    isInstalled,
    updateInfo,
    updateStatus,
    isChecking,
    isUpdating,
    isDownloadingDepot,
    isApplyingPatch,
    error,
    depotProgress,
    steamCredentials,
    selectDirectory,
    clearDirectory,
    checkForUpdates,
    startUpdate,
    launchGame,
    downloadDepot,
    cancelDownload,
    applyPatch,
    retryLastStep,
    saveSteamCredentials,
    clearSteamCredentials,
  }
}
