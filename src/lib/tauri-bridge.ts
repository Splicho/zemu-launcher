import { invoke } from '@tauri-apps/api/core'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'

type DebugMetadata = Record<string, unknown> | undefined

export interface GameLaunchState {
  isLaunching: boolean
  isRunning: boolean
}

export interface UpdateProgressFolder {
  folderName: string
  stage: 'downloading' | 'decompressing' | 'extracting' | 'complete'
  progress: number
  downloaded: number
  total: number
  speed?: number
}

export interface UpdateProgressFile {
  filePath: string
  stage: 'downloading' | 'decompressing' | 'extracting' | 'complete'
  progress: number
  downloaded: number
  total: number
  speed?: number
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
  folders: UpdateProgressFolder[]
  files?: UpdateProgressFile[]
  error?: string
}

export interface VersionManifest {
  version: string
  build: number
  releaseDate: string
  changelog?: string
  folders: {
    [folderName: string]: {
      checksum?: string
      size?: number
      compressedSize?: number
      fileCount: number
      files?: {
        [fileName: string]: FileManifestEntry
      }
    }
  }
  totalSize: number
  totalCompressedSize: number
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

export interface SteamCredentials {
  username: string
  refresh_token: string
  steam_id?: string
  last_login_at?: number
}

export type SteamLoginResult =
  | { status: 'needsGuard'; username: string; canUseMobileApproval?: boolean }
  | ({ status: 'authenticated' } & SteamCredentials)
  | { status: 'error'; message: string }

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function setupCompatibilityBridge() {
  const isTauriRuntime = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  if (!isTauriRuntime) {
    return
  }

  const appWindow = getCurrentWindow()
  const writeDebugLog = (source: string, message: string, metadata?: DebugMetadata) => {
    const content = metadata ? `${message} | ${safeStringify(metadata)}` : message
    void invoke('debug_log_write', { source, message: content }).catch(() => undefined)
  }

  const maximizedListeners = new Set<() => void>()
  const unmaximizedListeners = new Set<() => void>()
  let lastKnownMaximized = false

  void appWindow.isMaximized().then((value) => {
    lastKnownMaximized = value
  })

  void appWindow.onResized(async () => {
    const currentMaximized = await appWindow.isMaximized()
    if (currentMaximized === lastKnownMaximized) return

    lastKnownMaximized = currentMaximized
    const target = currentMaximized ? maximizedListeners : unmaximizedListeners
    target.forEach((callback) => callback())
  })

  window.electronAPI = {
    minimize: () => {
      void invoke('window_minimize').catch(() => appWindow.minimize())
    },
    maximize: () => {
      void invoke('window_maximize').catch(() => appWindow.maximize())
    },
    restore: () => {
      void invoke('window_restore').catch(() => appWindow.unmaximize())
    },
    close: () => {
      void invoke('window_close').catch(() => appWindow.close())
    },
    isMaximized: async () => invoke<boolean>('window_is_maximized').catch(() => appWindow.isMaximized()),
    isPackaged: async () => invoke<boolean>('app_is_packaged'),
    onMaximized: (callback: () => void) => {
      maximizedListeners.add(callback)
    },
    onUnmaximized: (callback: () => void) => {
      unmaximizedListeners.add(callback)
    },
  }

  window.gameAPI = {
    getDirectory: () => invoke<string | null>('game_get_directory'),
    setDirectory: (path: string) => invoke<boolean>('game_set_directory', { directory: path }),
    selectDirectory: () => invoke<string | null>('game_select_directory'),
    clearDirectory: () => invoke<boolean>('game_clear_directory'),
    isInstalled: () => invoke<boolean>('game_is_installed'),
    getLocalVersion: () => invoke<VersionManifest | null>('game_get_local_version'),
    checkUpdate: () => invoke<UpdateInfo>('game_check_update'),
    downloadUpdate: (gameDirectory: string) =>
      invoke<{ success: boolean; error?: string }>('game_download_update', { gameDirectory }),
    getUpdateStatus: () => invoke<UpdateStatus | null>('game_get_update_status'),
    getLaunchState: () => invoke<GameLaunchState>('game_get_launch_state'),
    cancelDownload: () => {
      void invoke('game_cancel_download')
    },
    onUpdateProgress: (callback: (status: UpdateStatus) => void): (() => void) => {
      let unlistenPromise: Promise<UnlistenFn> | null = null

      listen<UpdateStatus>('update-progress', (event) => {
        callback(event.payload)
      }).then((unlisten) => {
        unlistenPromise = Promise.resolve(unlisten)
      })

      return () => {
        if (unlistenPromise) {
          void unlistenPromise.then((unlisten) => unlisten())
        }
      }
    },
    onLaunchState: (callback: (state: GameLaunchState) => void): (() => void) => {
      let unlistenPromise: Promise<UnlistenFn> | null = null

      listen<GameLaunchState>('game-launch-state', (event) => {
        callback(event.payload)
      }).then((unlisten) => {
        unlistenPromise = Promise.resolve(unlisten)
      })

      return () => {
        if (unlistenPromise) {
          void unlistenPromise.then((unlisten) => unlisten())
        }
      }
    },
    launchGame: () => invoke<{ success: boolean; error?: string }>('game_launch'),
    downloadDepot: (
      manifestId: string,
      depotId: string,
      outputPath: string,
      credentials: SteamCredentials
    ) =>
      invoke<{ success: boolean; error?: string }>('game_download_depot', {
        manifestId,
        depotId,
        outputPath,
        credentials,
      }),
    onDepotProgress: (callback: (progress: DepotProgress) => void): (() => void) => {
      let unlistenPromise: Promise<UnlistenFn> | null = null

      listen<DepotProgress>('depot-progress', (event) => {
        callback(event.payload)
      }).then((unlisten) => {
        unlistenPromise = Promise.resolve(unlisten)
      })

      return () => {
        if (unlistenPromise) {
          void unlistenPromise.then((unlisten) => unlisten())
        }
      }
    },
  }

  window.discordAPI = {
    setInLauncher: () => {
      void invoke('discord_set_in_launcher').catch((error) => {
        writeDebugLog('discord', 'setInLauncher failed', { error: safeStringify(error) })
      })
    },
    setActivity: (details: string, state: string) => {
      void invoke('discord_set_activity', { details, state }).catch((error) => {
        writeDebugLog('discord', 'setActivity failed', {
          details,
          state,
          error: safeStringify(error),
        })
      })
    },
  }

  window.authAPI = {
    getToken: () => invoke<AuthToken | null>('auth_get_token'),
    saveToken: (token: AuthToken) => invoke<void>('auth_save_token', { token }),
    clearToken: () => invoke<void>('auth_clear_token'),
    generateOAuthState: (provider: string) => invoke<string>('auth_generate_oauth_state', { provider }),
    openOAuth: (provider: string) =>
      invoke<{ success: boolean; error?: string }>('auth_open_oauth', {
        provider,
        isDevRuntime: import.meta.env.DEV,
      }),
    manualOAuthCallback: (token: string, state?: string) =>
      invoke<{ success: boolean; error?: string }>('auth_manual_oauth_callback', { token, state }),
    completeOAuthToken: (token: string, isDevRuntime: boolean) =>
      invoke<AuthToken>('auth_complete_oauth_token', { token, isDevRuntime }),
    takePendingOAuthCallback: () =>
      invoke<{ token?: string; state?: string; error?: string } | null>('auth_take_pending_oauth_callback'),
  }

  window.debugLog = {
    write: (source: string, message: string) =>
      invoke<void>('debug_log_write', { source, message }).catch(() => {}),
    getPath: () => invoke<string>('debug_log_path'),
    read: () => invoke<string>('debug_log_read'),
    clear: () => invoke<void>('debug_log_clear'),
  }

  window.launcherAPI = {
    setRuntimeUpdateUrl: (url: string) => invoke<void>('launcher_set_runtime_update_url', { url }),
    getSteamCredentials: () => invoke<SteamCredentials | null>('launcher_get_steam_credentials'),
    saveSteamCredentials: (credentials: SteamCredentials) =>
      invoke<void>('launcher_save_steam_credentials', { credentials }),
    clearSteamCredentials: () => invoke<void>('launcher_clear_steam_credentials'),
    loginSteam: (username: string, password: string, guardCode?: string) =>
      invoke<SteamLoginResult>('launcher_steam_login', { username, password, guardCode }),
    onSteamMobileConfirmationPending: (cb: (payload: { username: string }) => void) => {
      return listen<{ username: string }>('steam-mobile-confirmation-pending', (e) => {
        cb(e.payload)
      })
    },
  }

  window.addEventListener('error', (event) => {
    writeDebugLog('frontend.error', event.message, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    writeDebugLog('frontend.unhandledrejection', 'Unhandled promise rejection', {
      reason: safeStringify(event.reason),
    })
  })
}

interface AuthToken {
  token: string
  userId: string
  email: string
  username?: string
  role?: string
  image?: string
  expiresAt?: number
}

declare global {
  interface Window {
    electronAPI: {
      minimize: () => void
      maximize: () => void
      restore: () => void
      close: () => void
      isMaximized: () => Promise<boolean>
      isPackaged: () => Promise<boolean>
      onMaximized: (callback: () => void) => void
      onUnmaximized: (callback: () => void) => void
    }
    gameAPI: {
      getDirectory: () => Promise<string | null>
      setDirectory: (path: string) => Promise<boolean>
      selectDirectory: () => Promise<string | null>
      clearDirectory: () => Promise<boolean>
      isInstalled: () => Promise<boolean>
      getLocalVersion: () => Promise<VersionManifest | null>
      checkUpdate: () => Promise<UpdateInfo>
      downloadUpdate: (gameDirectory: string) => Promise<{ success: boolean; error?: string }>
      getUpdateStatus: () => Promise<UpdateStatus | null>
      getLaunchState: () => Promise<GameLaunchState>
      cancelDownload: () => void
      onUpdateProgress: (callback: (status: UpdateStatus) => void) => () => void
      onLaunchState: (callback: (state: GameLaunchState) => void) => () => void
      launchGame: () => Promise<{ success: boolean; error?: string }>
      downloadDepot: (
        manifestId: string,
        depotId: string,
        outputPath: string,
        credentials: SteamCredentials
      ) => Promise<{ success: boolean; error?: string }>
      onDepotProgress: (callback: (progress: DepotProgress) => void) => () => void
    }
    discordAPI: {
      setInLauncher: () => void
      setActivity: (details: string, state: string) => void
    }
    authAPI: {
      getToken: () => Promise<AuthToken | null>
      saveToken: (token: AuthToken) => Promise<void>
      clearToken: () => Promise<void>
      generateOAuthState: (provider: string) => Promise<string>
      openOAuth: (provider: string) => Promise<{ success: boolean; error?: string }>
      manualOAuthCallback: (
        token: string,
        state?: string
      ) => Promise<{ success: boolean; error?: string }>
      completeOAuthToken: (token: string, isDevRuntime: boolean) => Promise<AuthToken>
      takePendingOAuthCallback: () => Promise<{ token?: string; state?: string; error?: string } | null>
    }
    debugLog: {
      write: (source: string, message: string) => Promise<void>
      getPath: () => Promise<string>
      read: () => Promise<string>
      clear: () => Promise<void>
    }
    launcherAPI: {
      setRuntimeUpdateUrl: (url: string) => Promise<void>
      getSteamCredentials: () => Promise<SteamCredentials | null>
      saveSteamCredentials: (credentials: SteamCredentials) => Promise<void>
      clearSteamCredentials: () => Promise<void>
      loginSteam: (username: string, password: string, guardCode?: string) => Promise<SteamLoginResult>
      onSteamMobileConfirmationPending: (
        cb: (payload: { username: string }) => void
      ) => Promise<UnlistenFn>
    }
  }
}

setupCompatibilityBridge()
