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

  if (hasFolder) {
    const installed = await safeDetectBaseGameInstalled(directory)
    if (installed) {
      hasBaseGame = true
      // The Rust `detect_base_game_installed` returns true only if both
      // the marker AND `H1Z1.exe` exist; we use it as `hasMarker=true`
      // for UI copy (existing Zemu install). The exe-only path doesn't
      // set `hasMarker` so the wizard can still show the manual path.
      hasMarker = true
    } else {
      // No marker → check whether `H1Z1.exe` is at the folder root
      // (user dropped in a manually-downloaded depot).
      const hasExe = await safeFileExists(directory, 'H1Z1.exe')
      if (hasExe) hasBaseGame = true
    }
  }

  return {
    hasKey,
    hasFolder,
    hasBaseGame,
    hasMarker,
    folderPath: hasFolder ? directory : null,
  }
}

async function safeGetAuthKey(): Promise<string | null> {
  try {
    return await window.launcherAPI?.getAuthKey?.()
  } catch {
    return null
  }
}

async function safeGetDirectory(): Promise<string | null> {
  try {
    return await window.gameAPI?.getDirectory?.()
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
    const invokeFn = (window as any).__TAURI_INTERNALS__?.invoke
    if (!invokeFn) return false
    return (await invokeFn('game_detect_base_game_installed', { directory })) === true
  } catch {
    return false
  }
}

async function safeFileExists(directory: string, name: string): Promise<boolean> {
  try {
    const invokeFn = (window as any).__TAURI_INTERNALS__?.invoke
    if (!invokeFn) return false
    return (await invokeFn('game_path_exists', { path: `${directory}/${name}` })) === true
  } catch {
    return false
  }
}
