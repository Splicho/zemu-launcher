/**
 * Authoritative "what does the user have on disk?" check used by the
 * onboarding wizard.
 *
 * Combines three reads into a single typed object so the wizard can
 * pre-fill steps that the user has already completed:
 *
 *   - `hasKey`     — a non-empty auth key is saved in launcher-config
 *   - `hasFolder`  — a game install directory has been chosen
 *   - `hasBaseGame` — either:
 *       (a) the Zemu marker file `.zemu-install-v1` is present at the
 *           folder root (a Zemu-managed install completed previously),
 *       (b) or `H1Z1.exe` is at the folder root (a manual install
 *           dropped in by the user).
 *   - `hasMarker`  — strictly the Zemu marker (subset of `hasBaseGame`).
 *           Distinguishes "auto-downloaded by Zemu" from "manually
 *           dropped PS3 folder".
 *
 * `hasBaseGame` is the gate for skipping Step 3 of the wizard (don't
 * re-download a 15 GB depot if the user already has it). The marker
 * check is the gate for "Existing Zemu install detected" UI copy.
 */

export interface SetupChecks {
  hasKey: boolean
  hasFolder: boolean
  hasBaseGame: boolean
  hasMarker: boolean
  /**
   * The actual install-directory path when `hasFolder` is true. Carried
   * alongside the boolean so the onboarding wizard can hydrate its
   * local `folder` state synchronously on first render — without this
   * the "Choose folder" button briefly shows the wrong label on every
   * restart while the async `getDirectory()` IPC round-trip resolves.
   * `null` whenever `hasFolder` is false.
   */
  folderPath: string | null
}

/**
 * What lives at the root of a given folder.
 *
 * Exported separately from `getSetupChecks` because the wizard needs to
 * ask the same question about a folder the user has *not* saved yet —
 * most importantly the auto-selected default (`C:\ZEmu`), which may
 * already hold an install left behind by a previous launcher install.
 * Answering that up front lets Step 2 skip the 15 GB depot step rather
 * than re-download over files that are already on disk.
 */
export interface BaseGamePresence {
  /** `H1Z1.exe` at the folder root, with or without the Zemu marker. */
  hasBaseGame: boolean
  /** Strictly the Zemu marker — a Zemu-managed install. */
  hasMarker: boolean
}

/**
 * Read each input from the Rust side in parallel. The bridge methods
 * are best-effort: a missing API (e.g. in non-Tauri dev) yields
 * `null`/`undefined`, which we coerce to `false`. The wizard treats
 * `false` as "not set yet" so the user sees every step, never a
 * half-skipped flow on a failed read.
 */
export async function getSetupChecks(): Promise<SetupChecks> {
  const [authKey, directory] = await Promise.all([
    safeGetAuthKey(),
    safeGetDirectory(),
  ])

  const hasKey = !!authKey && authKey.trim() !== ''
  const hasFolder = !!directory && directory.trim() !== ''

  let hasBaseGame = false
  let hasMarker = false

  if (hasFolder && directory) {
    const presence = await detectBaseGameIn(directory)
    hasBaseGame = presence.hasBaseGame
    hasMarker = presence.hasMarker
  }

  return {
    hasKey,
    hasFolder,
    hasBaseGame,
    hasMarker,
    folderPath: hasFolder ? directory : null,
  }
}

/**
 * Detect the base game inside an arbitrary folder.
 *
 *   - `(b)` `H1Z1.exe` at the folder root → the user dropped a depot in
 *     by hand, so the game is there but there is no Zemu marker.
 *   - `(a)` `.zemu-install-v1` next to `H1Z1.exe` → a Zemu-managed
 *     install that already completed on this machine.
 *
 * Empty/blank paths and IPC failures resolve to "nothing there" — the
 * caller then keeps the user on the download step, which is the safe
 * direction (a false negative re-checks a folder, a false positive
 * would skip a download that never happened).
 */
export async function detectBaseGameIn(
  directory: string,
): Promise<BaseGamePresence> {
  if (!directory || directory.trim() === '') {
    return { hasBaseGame: false, hasMarker: false }
  }

  const markerAndExe = await safeDetectBaseGameInstalled(directory)
  if (markerAndExe) {
    return { hasBaseGame: true, hasMarker: true }
  }

  const hasExe = await safeFileExists(directory, 'H1Z1.exe')
  return { hasBaseGame: hasExe, hasMarker: false }
}

async function safeGetAuthKey(): Promise<string | null> {
  try {
    const value = await window.launcherAPI?.getAuthKey?.()
    // The Rust side stores the key verbatim; an empty/whitespace
    // return means "no key set", not "the key is empty". Coerce so
    // callers can do a plain truthiness check without having to
    // remember the trim dance.
    if (typeof value === 'string' && value.trim().length > 0) {
      return value
    }
    return null
  } catch {
    return null
  }
}

async function safeGetDirectory(): Promise<string | null> {
  try {
    const value = await window.gameAPI?.getDirectory?.()
    // Same as `safeGetAuthKey`: the Rust side should never store an
    // empty path, but if it returns one (storage drift, partial
    // write, etc.) we want the gate to see "no folder" rather than
    // an empty string that slips past a `!!value` check.
    if (typeof value === 'string' && value.trim().length > 0) {
      return value
    }
    return null
  } catch {
    return null
  }
}

async function safeDetectBaseGameInstalled(directory: string): Promise<boolean> {
  try {
    // The Rust command is registered in Phase 2 as
    // `game_detect_base_game_installed`. Until that command is wired
    // up, the call will throw and we'll fall through to the exe-only
    // check — keeping the wizard functional with or without the new
    // Rust side in place.
    const tauriInternals = window as unknown as {
      __TAURI_INTERNALS__?: { invoke?: (cmd: string, args: unknown) => Promise<unknown> }
    }
    const invokeFn = tauriInternals.__TAURI_INTERNALS__?.invoke
    if (!invokeFn) return false
    const result = await invokeFn('game_detect_base_game_installed', { directory })
    return result === true
  } catch {
    return false
  }
}

async function safeFileExists(directory: string, name: string): Promise<boolean> {
  try {
    const tauriInternals = window as unknown as {
      __TAURI_INTERNALS__?: { invoke?: (cmd: string, args: unknown) => Promise<unknown> }
    }
    const invokeFn = tauriInternals.__TAURI_INTERNALS__?.invoke
    if (!invokeFn) return false
    const result = await invokeFn('game_path_exists', { path: `${directory}/${name}` })
    return result === true
  } catch {
    return false
  }
}
