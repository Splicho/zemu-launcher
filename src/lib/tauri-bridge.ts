import { invoke } from '@tauri-apps/api/core'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'

import { normalizeAppError, type AppErrorPayload } from './app-errors'

type DebugMetadata = Record<string, unknown> | undefined

export interface GameLaunchState {
  isLaunching: boolean
  isRunning: boolean
}

export interface UpdateProgressFile {
  filePath: string
  stage: 'downloading' | 'verifying' | 'complete'
  progress: number
  downloaded: number
  total: number
  speed?: number
}

export interface UpdateStatus {
  isUpdating: boolean
  currentFile?: string
  totalFiles: number
  completedFiles: number
  overallProgress: number
  files?: UpdateProgressFile[]
  error?: string
}

/**
 * One file entry in the compressor manifest. Produced by
 * `tauri-compressor` and consumed by the launcher.
 *
 * - `hash` is the blake3 hex digest of the original uncompressed bytes
 * - `compressedHash` is the SHA-256 hex digest of the `.zst` payload
 *   (what the launcher downloads from the CDN)
 */
export interface CompressorManifestEntry {
  path: string
  size: number
  hash: string
  compressedSize: number
  compressedHash: string
}

/**
 * One file that was removed between the previous published manifest
 * and this one. The launcher uses this list to delete stale files
 * from disk after a successful update.
 */
export interface RemovedEntry {
  path: string
  size: number
  hash: string
}

/**
 * The compressor manifest. Same shape on both producer
 * (`tauri-compressor`) and consumer (`zemu-launcher`) sides.
 */
export interface CompressorManifest {
  version: string
  files: CompressorManifestEntry[]
  removed: RemovedEntry[]
}

export interface UpdateInfo {
  hasUpdate: boolean
  cdnAvailable: boolean
  currentVersion?: string
  latestVersion?: string
  filesToUpdate?: Array<{ path: string; entry: CompressorManifestEntry }>
}

export interface DepotProgress {
  stage?: string | null
  message?: string | null
  bytesDone?: number | null
  bytesTotal?: number | null
  speedBps?: number | null
  etaSeconds?: number | null
}

/** Persisted installation job (`launcher-config.json` → `installJob`). */
export interface InstallJobRecord {
  destination: string
  /** `client` while the depot download runs, `patch` once it finished. */
  stage: string
  updatedAtUnix: number
}

/** Result of comparing a folder's executable against the recorded build. */
export interface BaseBuildCheck {
  status: 'supported' | 'patched' | 'mismatch' | 'unknown' | 'missing' | string
  recordedHash?: string | null
  actualHash?: string | null
}

// ─── Pre-launch integrity check ──────────────────────────────────────────
//
// Wire types for `gameAPI.verifyAndRepair`. Mirrors the Rust types in
// `src-tauri/src/models.rs` (camelCase field names).

export type TamperReason = 'hashMismatch' | 'missing' | 'sizeMismatch'

export interface TamperedFile {
  path: string
  reason: TamperReason
  expectedBlake3: string
  actualBlake3?: string | null
}

export type VerifyStatus = 'clean' | 'repaired' | 'tamperedCdnDown'

export interface VerifyOutcome {
  status: VerifyStatus
  tampered: TamperedFile[]
  /**
   * True when the CDN was reachable during this check. `false`
   * means either `update_base_url` was unset or the manifest fetch
   * failed. Surfaced separately from `status === 'tamperedCdnDown'`
   * so the renderer can show a distinct "CDN is offline" toast on a
   * clean-but-offline install.
   */
  cdnAvailable: boolean
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

/**
 * Subscribe to a Tauri event and return a synchronous teardown.
 *
 * ## Why this exists
 *
 * `listen()` is async, but React effect cleanup is not. The pattern
 * this replaces was:
 *
 *     let unlistenPromise: Promise<UnlistenFn> | null = null
 *     listen('evt', cb).then((u) => { unlistenPromise = Promise.resolve(u) })
 *     return () => { if (unlistenPromise) void unlistenPromise.then((u) => u()) }
 *
 * When cleanup ran before `listen()` resolved, `unlistenPromise` was
 * still `null` and the branch was skipped — **the listener was never
 * removed**. It stayed attached for the life of the process and kept
 * firing into an unmounted component. In the onboarding wizard that
 * showed up as `depot-done` firing long after Step 3 was torn down,
 * re-running `onContinue()` and re-advancing the wizard, which in turn
 * re-mounted Step 3 and started a fresh Steam login — a remount loop
 * that logged a `scan_and_go_begin` storm every couple of seconds.
 *
 * This helper closes that window by tracking cancellation in a flag
 * and unlistening immediately if teardown wins the race.
 */
function subscribe<T>(
  event: string,
  callback: (payload: T) => void,
): () => void {
  let unlisten: UnlistenFn | null = null
  let cancelled = false

  listen<T>(event, (e) => {
    // A listener that lost the teardown race must not deliver.
    if (cancelled) return
    callback(e.payload)
  })
    .then((stop) => {
      if (cancelled) {
        // Teardown already happened — remove it now.
        stop()
        return
      }
      unlisten = stop
    })
    .catch(() => {
      /* listener registration failed; nothing to tear down */
    })

  return () => {
    cancelled = true
    if (unlisten) {
      unlisten()
      unlisten = null
    }
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
    pickFolder: (startDir?: string) =>
      invoke<string | null>('game_pick_folder', { startDir: startDir ?? null }),
    getFreeSpace: (path: string) => invoke<number | null>('game_get_free_space', { path }),
    getInstallJob: () => invoke<InstallJobRecord | null>('game_get_install_job'),
    setInstallJob: (destination: string, stage: string) =>
      invoke<void>('game_set_install_job', { destination, stage }),
    clearInstallJob: () => invoke<void>('game_clear_install_job'),
    checkBaseBuild: (directory: string) =>
      invoke<BaseBuildCheck>('game_check_base_build', { directory }),
    getDefaultInstallDirectory: () =>
      invoke<string>('game_get_default_install_directory'),
    clearDirectory: () => invoke<boolean>('game_clear_directory'),
    getFolderSize: (directory: string) =>
      invoke<number>('game_get_folder_size', { directory }),
    openInFileManager: (directory: string) =>
      invoke<void>('game_open_in_file_manager', { directory }),
    isInstalled: () => invoke<boolean>('game_is_installed'),
      getLocalVersion: () => invoke<CompressorManifest | null>('game_get_local_version'),
    checkUpdate: (skipFiles: string[] = []) =>
      invoke<UpdateInfo>('game_check_update', { skipFiles }),
    downloadUpdate: (gameDirectory: string, skipFiles: string[] = []) =>
      invoke<{ success: boolean; error?: string }>('game_download_update', {
        gameDirectory,
        skipFiles,
      }),
    getUpdateStatus: () => invoke<UpdateStatus | null>('game_get_update_status'),
    getLaunchState: () => invoke<GameLaunchState>('game_get_launch_state'),
    cancelDownload: () => {
      void invoke('game_cancel_download')
    },
    onUpdateProgress: (callback: (status: UpdateStatus) => void): (() => void) =>
      subscribe<UpdateStatus>('update-progress', (payload) => callback(payload)),
    onLaunchState: (callback: (state: GameLaunchState) => void): (() => void) =>
      subscribe<GameLaunchState>('game-launch-state', (payload) => callback(payload)),
    launchGame: () => invoke<{ success: boolean; error?: string }>('game_launch'),
    verifyAndRepair: (skipFiles: string[] = []) =>
      invoke<VerifyOutcome>('game_verify_and_repair', { skipFiles }),
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
    onQr: (callback: (dataUrl: string) => void): (() => void) =>
      subscribe<string>('steam-qr', (payload) => callback(payload)),
    onScanned: (callback: () => void): (() => void) =>
      subscribe<void>('steam-scanned', () => callback()),
    onAuthed: (callback: (accountName: string) => void): (() => void) =>
      subscribe<string>('steam-authed', (payload) => callback(payload)),
    onLoginError: (callback: (error: AppErrorPayload) => void): (() => void) =>
      // `steam-error` carries `{ code, message, detail, retryable }` from
      // `src-tauri/src/errors.rs`. Normalizing here (rather than at every
      // call site) also keeps the wizard working against a backend build
      // that still emits a bare string during a staged upgrade.
      subscribe<unknown>('steam-error', (payload) =>
        callback(normalizeAppError(payload)),
      ),
    onDepotProgress: (callback: (progress: DepotProgress) => void): (() => void) =>
      subscribe<DepotProgress>('depot-progress', (payload) => callback(payload)),
    onDepotDone: (callback: (result: { finalDir: string; bytes: number }) => void): (() => void) =>
      subscribe<{ finalDir: string; bytes: number }>('depot-done', (payload) =>
        callback(payload),
      ),
    onDepotError: (callback: (error: AppErrorPayload) => void): (() => void) =>
      subscribe<unknown>('depot-error', (payload) =>
        callback(normalizeAppError(payload)),
      ),
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
    /**
     * Returns the currently saved auth key, if any. The value is stored
     * locally in the OS keychain (not on disk in plaintext) and is
     * never validated against a server.
     */
    getAuthKey: () => invoke<string | null>('launcher_get_auth_key'),
    /**
     * Persist a new auth key, replacing any previously saved value.
     * An empty string clears the key.
     */
    setAuthKey: (key: string) => invoke<void>('launcher_set_auth_key', { key }),
    /**
     * Read the persisted first-run onboarding completed flag.
     * Defaults to `false` on fresh installs and on configs written
     * before this field existed — the gate falls through to on-disk
     * checks before trusting the flag.
     */
    getOnboardingCompleted: () =>
      invoke<boolean>('launcher_get_onboarding_completed'),
    /**
     * Persist the first-run onboarding completed flag. `true` after
     * the wizard's Finish click and after the install-check
     * pre-screen's "Yes" branch. The flag is advisory — the gate
     * still re-validates key + folder + base game on disk before
     * letting the user past `#/`.
     */
    setOnboardingCompleted: (completed: boolean) =>
      invoke<void>('launcher_set_onboarding_completed', { completed }),
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
    getAppDataDir: () =>
      invoke<string>('launcher_get_app_data_dir').catch((error) => {
        writeDebugLog('launcher.advanced', 'getAppDataDir failed', {
          error: safeStringify(error),
        })
        // Fall through to an empty string so the UI can render the
        // "path unavailable" branch rather than crashing the page.
        return ''
      }),
    openAppDataDir: () =>
      invoke<void>('launcher_open_app_data_dir').catch((error) => {
        writeDebugLog('launcher.advanced', 'openAppDataDir failed', {
          error: safeStringify(error),
        })
      }),
    fetchAvatarBytes: (url: string) =>
      invoke<{ status: number; contentType: string; bodyBase64: string }>(
        'avatar_fetch_bytes',
        { url },
      ),
  }

  // The launcher is dark-only: there is no OS theme detection and no user
  // preference to load. `index.html` already ships `class="dark"`; this keeps
  // the class in place if some other code ever removes it, and drops the stale
  // `zemu.theme` key older builds wrote.
  document.documentElement.classList.add('dark')
  try {
    localStorage.removeItem('zemu.theme')
  } catch {
    // localStorage may be unavailable (private mode / sandboxed webview).
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
    /**
     * Friends-specific debug logger bridge. Lives on `window` so the
     * renderer can poke it from DevTools:
     *   await window.friendsDebugLog.write('manual', 'test')
     *   await window.friendsDebugLog.getPath()
     * The Rust side writes to `%APPDATA%\uk.zemu.launcher\friendlist-
     * debug.log`. Wired from `setupCompatibilityBridge()` below.
     */
    friendsDebugLog: {
      write: (source: string, message: string) => Promise<void>
      getPath: () => Promise<string>
      read: () => Promise<string>
      clear: () => Promise<void>
    }
    gameAPI: {
      getDirectory: () => Promise<string | null>
      setDirectory: (path: string) => Promise<boolean>
      selectDirectory: () => Promise<string | null>
      /**
       * Pick a folder **without** persisting it as the game directory.
       * Used by the install dialog's "Change" button; the dialog commits
       * the path with `setDirectory` only when the user hits Install.
       */
      pickFolder: (startDir?: string) => Promise<string | null>
      /**
       * Free bytes on the volume that would hold `path` (nearest existing
       * ancestor is measured when the folder doesn't exist yet). `null`
       * on platforms without an implementation — callers omit the row
       * rather than invent a number.
       */
      getFreeSpace: (path: string) => Promise<number | null>
      /** Persisted install job; `null` when nothing is in flight. */
      getInstallJob: () => Promise<InstallJobRecord | null>
      setInstallJob: (destination: string, stage: string) => Promise<void>
      clearInstallJob: () => Promise<void>
      /** Compare a folder's `H1Z1.exe` to the recorded supported build. */
      checkBaseBuild: (directory: string) => Promise<BaseBuildCheck>
      /**
       * Folder the install dialog pre-selects when no install directory
       * is configured yet: the volume the OS is installed on plus
       * `\Games\ZEmu` (`C:\Games\ZEmu` on a default Windows machine,
       * `$HOME/Games/ZEmu` on the Wine/Proton builds). Never creates the
       * folder — the depot download does that. Existing configured
       * directories are never migrated to it.
       */
      getDefaultInstallDirectory: () => Promise<string>
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
      getLocalVersion: () => Promise<CompressorManifest | null>
      checkUpdate: (skipFiles?: string[]) => Promise<UpdateInfo>
      downloadUpdate: (
        gameDirectory: string,
        skipFiles?: string[],
      ) => Promise<{ success: boolean; error?: string }>
      getUpdateStatus: () => Promise<UpdateStatus | null>
      getLaunchState: () => Promise<GameLaunchState>
      cancelDownload: () => void
      onUpdateProgress: (callback: (status: UpdateStatus) => void) => () => void
      onLaunchState: (callback: (state: GameLaunchState) => void) => () => void
      launchGame: () => Promise<{ success: boolean; error?: string }>
      /**
       * Pre-launch patch integrity check. Walks every manifest
       * entry on disk, blake3-hashes it against the recorded hash,
       * and re-downloads any tampered or missing entry from the
       * CDN. The launch button on the renderer must await this
       * before calling `launchGame`; if the result status is
       * `tamperedCdnDown` the renderer must refuse to launch.
       */
      verifyAndRepair: (skipFiles?: string[]) => Promise<VerifyOutcome>
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
      onLoginError: (callback: (error: AppErrorPayload) => void) => () => void
      onDepotProgress: (callback: (progress: DepotProgress) => void) => () => void
      onDepotDone: (
        callback: (result: { finalDir: string; bytes: number }) => void
      ) => () => void
      onDepotError: (callback: (error: AppErrorPayload) => void) => () => void
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
      /** Returns the currently saved auth key, if any. */
      getAuthKey: () => Promise<string | null>
      /** Persist a new auth key. An empty string clears the key. */
      setAuthKey: (key: string) => Promise<void>
      /**
       * Read the first-run onboarding completed flag. Defaults to
       * `false` on fresh installs.
       */
      getOnboardingCompleted: () => Promise<boolean>
      /**
       * Persist the first-run onboarding completed flag. The flag
       * is advisory — the gate still re-validates the on-disk
       * install before letting the user past `#/`.
       */
      setOnboardingCompleted: (completed: boolean) => Promise<void>
      /** Returns the persisted game locale (`xx_yy` tag), defaulting to `en_us`. */
      getLocale: () => Promise<string>
      /** Persist the game locale. Empty string clears it. */
      setLocale: (locale: string) => Promise<void>
      getAutostartEnabled: () => Promise<boolean>
      setAutostartEnabled: (enabled: boolean) => Promise<void>
      /**
       * Platform-resolved app-data directory. Resolves to
       * `%APPDATA%\uk.zemu.launcher` on Windows,
       * `~/Library/Application Support/uk.zemu.launcher` on macOS,
       * and `$XDG_DATA_HOME/uk.zemu.launcher` on Linux. Shown in
       * the Advanced settings tab so users know where to find
       * logs / saved config / cached update metadata.
       */
      getAppDataDir: () => Promise<string>
      /**
       * Open the app-data directory in the user's OS file manager.
       * The directory is `ensure_app_data_dir`'d first so the user
       * never sees a missing-folder error on first launch.
       */
      openAppDataDir: () => Promise<void>
      /**
       * Download a remote image as raw bytes. Goes through Rust +
       * `reqwest` (no CORS check) so CDNs that don't send
       * `Access-Control-Allow-Origin` headers don't silently 404
       * the way they would for a webview `fetch()`. Returns the
       * response bytes base64-encoded alongside the upstream
       * Content-Type so the renderer can build a typed `Blob` and
       * feed it to the existing avatar downscale pipeline.
       *
       * Throws on non-2xx or oversized responses. Caller is
       * expected to log the failure (the avatar-sync hook already
       * has a `friendsDebugLog` channel).
       */
      fetchAvatarBytes: (
        url: string,
      ) => Promise<{ status: number; contentType: string; bodyBase64: string }>
    }
  }
}

setupCompatibilityBridge()
