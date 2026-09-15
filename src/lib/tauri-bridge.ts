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

export interface DepotProgress {
  stage?: string | null
  message?: string | null
  bytesDone?: number | null
  bytesTotal?: number | null
  speedBps?: number | null
  etaSeconds?: number | null
}

export interface SteamAuthStatus {
  authed: boolean
  accountName?: string | null
}

export interface SteamcmdResult {
  finalDir: string
  depotBytes: number
  durationMs: number
  logTail: string
}

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
    getFolderSize: (directory: string) =>
      invoke<number>('game_get_folder_size', { directory }),
    openInFileManager: (directory: string) =>
      invoke<void>('game_open_in_file_manager', { directory }),
    isInstalled: () => invoke<boolean>('game_is_installed'),
    getLocalVersion: () => invoke<VersionManifest | null>('game_get_local_version'),
    checkUpdate: (skipFiles: string[] = []) =>
      invoke<UpdateInfo>('game_check_update', { skipFiles }),
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
    detectBaseGameInstalled: (directory: string) =>
      invoke<boolean>('game_detect_base_game_installed', { directory }),
    pathExists: (path: string) => invoke<boolean>('game_path_exists', { path }),
  }

  window.steamApi = {
    isAvailable: () => invoke<boolean>('steam_bridge_is_available'),
    loginStatus: () =>
      invoke<SteamAuthStatus>('steam_login_status'),
    loginBegin: () => invoke<void>('steam_login_begin'),
    loginCancel: () => invoke<void>('steam_login_cancel'),
    logout: () => invoke<void>('steam_logout'),
    installDepot: (destDir: string) =>
      invoke<SteamcmdResult>('steam_install_depot', { destDir }),
    /**
     * Scan-and-go: kicks off the QR login and the depot download
     * on the same runtime. Subscribers on `steam-qr` /
     * `steam-scanned` / `steam-authed` / `depot-progress` /
     * `depot-done` / `depot-error` get every event for both
     * phases — the QR scan transitions straight into the download
     * with no extra user click required.
     */
    startInstallPipeline: (destDir: string) =>
      invoke<void>('steam_start_install_pipeline', { destDir }),
    onQr: (callback: (dataUrl: string) => void): (() => void) => {
      let unlistenPromise: Promise<UnlistenFn> | null = null
      listen<string>('steam-qr', (event) => {
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
    onScanned: (callback: () => void): (() => void) => {
      let unlistenPromise: Promise<UnlistenFn> | null = null
      listen<void>('steam-scanned', () => {
        callback()
      }).then((unlisten) => {
        unlistenPromise = Promise.resolve(unlisten)
      })
      return () => {
        if (unlistenPromise) {
          void unlistenPromise.then((unlisten) => unlisten())
        }
      }
    },
    onAuthed: (callback: (accountName: string) => void): (() => void) => {
      let unlistenPromise: Promise<UnlistenFn> | null = null
      listen<string>('steam-authed', (event) => {
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
    onLoginError: (callback: (message: string) => void): (() => void) => {
      let unlistenPromise: Promise<UnlistenFn> | null = null
      listen<string>('steam-error', (event) => {
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
    onDepotDone: (callback: (result: { finalDir: string; bytes: number }) => void): (() => void) => {
      let unlistenPromise: Promise<UnlistenFn> | null = null
      listen<{ finalDir: string; bytes: number }>('depot-done', (event) => {
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
    onDepotError: (callback: (message: string) => void): (() => void) => {
      let unlistenPromise: Promise<UnlistenFn> | null = null
      listen<string>('depot-error', (event) => {
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
    getEnabled: () =>
      invoke<boolean>('discord_get_enabled').catch((error) => {
        writeDebugLog('discord', 'getEnabled failed', { error: safeStringify(error) })
        return true
      }),
    setEnabled: (enabled: boolean) => {
      void invoke('discord_set_enabled', { enabled }).catch((error) => {
        writeDebugLog('discord', 'setEnabled failed', {
          enabled,
          error: safeStringify(error),
        })
      })
    },
    getMode: () =>
      invoke<string>('discord_get_mode').catch((error) => {
        writeDebugLog('discord', 'getMode failed', { error: safeStringify(error) })
        return 'always'
      }),
    setMode: (mode: string) => {
      void invoke('discord_set_mode', { mode }).catch((error) => {
        writeDebugLog('discord', 'setMode failed', { mode, error: safeStringify(error) })
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

  // Friends-specific debug log — writes to `%APPDATA%\com.zemuuk.launcher
  // \friendlist-debug.log` instead of the main `launcher-debug.log`.
  // Exposed for ad-hoc probing from DevTools:
  //   await window.friendsDebugLog.getPath()
  //   await window.friendsDebugLog.read()
  //   await window.friendsDebugLog.clear()
  window.friendsDebugLog = {
    write: (source: string, message: string) =>
      invoke<void>('friends_debug_log_write', { source, message }).catch(() => {}),
    getPath: () => invoke<string>('friends_debug_log_path'),
    read: () => invoke<string>('friends_debug_log_read'),
    clear: () => invoke<void>('friends_debug_log_clear'),
  }

  window.wineAPI = {
    getConfig: () => invoke<WineConfig>('wine_get_config'),
    saveConfig: (config: WineConfig) =>
      invoke<WineConfig>('wine_save_config', { config }),
    listRuntimes: () => invoke<WineRuntime[]>('wine_list_runtimes'),
    selectPrefixDirectory: () =>
      invoke<string | null>('wine_select_prefix_directory'),
    selectRuntimeExecutable: () =>
      invoke<string | null>('wine_select_runtime_executable'),
  }

  window.friendsAPI = {
    dispatch: (action: string, payload?: Record<string, unknown>) =>
      invoke<unknown>('friends_dispatch', { action, payload }).catch((error) => {
        writeDebugLog('friends', 'dispatch failed', {
          action,
          error: safeStringify(error),
        })
        throw error
      }),
  }

  window.launcherAPI = {
    setRuntimeUpdateUrl: (url: string) => invoke<void>('launcher_set_runtime_update_url', { url }),
    /** Push the realtime socket URL from the renderer to the Rust side. Called
     * once on startup so the socket loop reads the correct URL without needing
     * the Rust side to mirror Vite env vars. */
    setRealtimeUrl: (url: string) => invoke<void>('launcher_set_realtime_url', { url }),
    /**
     * Returns the currently saved auth key, if any. The value is stored
     * locally and is never validated against a server.
     */
    getAuthKey: () => invoke<string | null>('launcher_get_auth_key'),
    /**
     * Persist a new auth key, replacing any previously saved value.
     * An empty string clears the key.
     */
    setAuthKey: (key: string) => invoke<void>('launcher_set_auth_key', { key }),
    /**
     * Read the persisted game locale (lowercase `xx_yy` tag like
     * `en_us`, `fr_fr`, `zh_cn`). Falls back to `en_us` when the
     * user hasn't picked one yet or the config was written before
     * this field existed.
     */
    getLocale: () => invoke<string>('launcher_get_locale'),
    /**
     * Persist the game locale. An empty string clears the stored
     * tag so subsequent launches fall back to the game's default.
     * Unknown tags are rejected by the Rust side.
     */
    setLocale: (locale: string) =>
      invoke<void>('launcher_set_locale', { locale }),
    /**
     * Whether the launcher is currently registered with the OS
     * autostart mechanism (e.g. `HKCU\...\Run` on Windows). Reading
     * reflects the real OS state — not a cached config value — so the
     * Settings toggle can recover correctly even if the user toggles
     * the entry in Task Manager > Startup.
     */
    getAutostartEnabled: () =>
      invoke<boolean>('launcher_get_autostart_enabled').catch((error) => {
        writeDebugLog('autostart', 'getAutostartEnabled failed', {
          error: safeStringify(error),
        })
        return false
      }),
    /**
     * Enable or disable the OS-managed autostart entry. Returns once
     * the registry / LaunchAgent write succeeds so the UI can reflect
     * the new state.
     */
    setAutostartEnabled: (enabled: boolean) =>
      invoke<void>('launcher_set_autostart_enabled', { enabled }).catch((error) => {
        writeDebugLog('autostart', 'setAutostartEnabled failed', {
          enabled,
          error: safeStringify(error),
        })
      }),
    getTheme: () =>
      invoke<string>('theme_get').catch((error) => {
        writeDebugLog('theme', 'getTheme failed', { error: safeStringify(error) })
        return 'system'
      }),
    setTheme: (theme: string) =>
      invoke<void>('theme_set', { theme }).catch((error) => {
        writeDebugLog('theme', 'setTheme failed', { theme, error: safeStringify(error) })
      }),
  }

  // Apply the persisted theme before the first paint so there is no flash.
  const cacheTheme = (value: string) => {
    try {
      localStorage.setItem('zemu.theme', value)
    } catch {
      // localStorage may be unavailable (private mode / sandboxed webview);
      // falling back to the in-memory theme applier is fine.
    }
  }
  void invoke<string>('theme_get')
    .then((t) => {
      cacheTheme(t)
      const root = document.documentElement
      if (t === 'dark') root.classList.add('dark')
      else if (t === 'light') root.classList.remove('dark')
      // 'system' (or unknown) — dark by default, fall back to OS preference
      else {
        const prefersDark =
          window.matchMedia &&
          window.matchMedia('(prefers-color-scheme: dark)').matches
        if (prefersDark !== false) root.classList.add('dark')
        else root.classList.remove('dark')
      }
    })
    .catch(() => {})

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

export interface WineEnvVar {
  key: string
  value: string
}

export interface WineConfig {
  enabled: boolean
  runtimeId?: string | null
  customRuntimePath?: string | null
  winePrefix?: string | null
  env: WineEnvVar[]
}

export interface WineRuntime {
  id: string
  name: string
  kind: 'wine' | 'proton' | 'custom'
  path: string
  version?: string | null
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
      /**
       * Total byte size of every regular file in `directory`,
       * recursively. Returns 0 if the directory doesn't exist.
       */
      getFolderSize: (directory: string) => Promise<number>
      /**
       * Open the user's OS file manager pointed at `directory`.
       */
      openInFileManager: (directory: string) => Promise<void>
      isInstalled: () => Promise<boolean>
      /**
       * True iff `.zemu-install-v1` AND `H1Z1.exe` exist at the
       * directory root. Used by the wizard to detect a previously-
       * completed SteamCMD auto-download.
       */
      detectBaseGameInstalled: (directory: string) => Promise<boolean>
      /** Cheap path existence check. */
      pathExists: (path: string) => Promise<boolean>
      getLocalVersion: () => Promise<VersionManifest | null>
      checkUpdate: (skipFiles?: string[]) => Promise<UpdateInfo>
      downloadUpdate: (gameDirectory: string) => Promise<{ success: boolean; error?: string }>
      getUpdateStatus: () => Promise<UpdateStatus | null>
      getLaunchState: () => Promise<GameLaunchState>
      cancelDownload: () => void
      onUpdateProgress: (callback: (status: UpdateStatus) => void) => () => void
      onLaunchState: (callback: (state: GameLaunchState) => void) => () => void
      launchGame: () => Promise<{ success: boolean; error?: string }>
    }
    steamApi: {
      isAvailable: () => Promise<boolean>
      loginStatus: () => Promise<SteamAuthStatus>
      loginBegin: () => Promise<void>
      loginCancel: () => Promise<void>
      logout: () => Promise<void>
      installDepot: (destDir: string) => Promise<SteamcmdResult>
      /**
       * Scan-and-go: kicks off the QR login and the depot download
       * on the same runtime. Subscribers on `steam-qr` /
       * `steam-scanned` / `steam-authed` / `depot-progress` /
       * `depot-done` / `depot-error` get every event for both
       * phases.
       */
      startInstallPipeline: (destDir: string) => Promise<void>
      onQr: (callback: (dataUrl: string) => void) => () => void
      onScanned: (callback: () => void) => () => void
      onAuthed: (callback: (accountName: string) => void) => () => void
      onLoginError: (callback: (message: string) => void) => () => void
      onDepotProgress: (callback: (progress: DepotProgress) => void) => () => void
      onDepotDone: (
        callback: (result: { finalDir: string; bytes: number }) => void
      ) => () => void
      onDepotError: (callback: (message: string) => void) => () => void
    }
    discordAPI: {
      setInLauncher: () => void
      setActivity: (details: string, state: string) => void
      getEnabled: () => Promise<boolean>
      setEnabled: (enabled: boolean) => void
      getMode: () => Promise<string>
      setMode: (mode: string) => void
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
    wineAPI: {
      getConfig: () => Promise<WineConfig>
      saveConfig: (config: WineConfig) => Promise<WineConfig>
      listRuntimes: () => Promise<WineRuntime[]>
      selectPrefixDirectory: () => Promise<string | null>
      selectRuntimeExecutable: () => Promise<string | null>
    }
    friendsAPI: {
      /**
       * Single RPC entry point for every friends action. The Rust
       * side maps the discriminated `action` string to the
       * appropriate handler (`list`, `search`, `request`,
       * `accept`, `decline`, `cancel`, `remove`, `profile`).
       */
      dispatch: (
        action: string,
        payload?: Record<string, unknown>,
      ) => Promise<unknown>
    }
    launcherAPI: {
      setRuntimeUpdateUrl: (url: string) => Promise<void>
      /** Push the realtime socket URL from the renderer to the Rust side. */
      setRealtimeUrl: (url: string) => Promise<void>
      /** Returns the currently saved auth key, if any. */
      getAuthKey: () => Promise<string | null>
      /** Persist a new auth key. An empty string clears the key. */
      setAuthKey: (key: string) => Promise<void>
      /** Returns the persisted game locale (`xx_yy` tag), defaulting to `en_us`. */
      getLocale: () => Promise<string>
      /** Persist the game locale. Empty string clears it. */
      setLocale: (locale: string) => Promise<void>
      getAutostartEnabled: () => Promise<boolean>
      setAutostartEnabled: (enabled: boolean) => Promise<void>
      getTheme: () => Promise<string>
      setTheme: (theme: string) => Promise<void>
    }
  }
}

setupCompatibilityBridge()
