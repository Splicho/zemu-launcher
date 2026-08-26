/**
 * Persistence for the "user has seen the Steam install instructions"
 * state.
 *
 * Since the launcher no longer ships the Steam SDK we ask users to
 * grab the base game via Steam's `download_depot` console command
 * before pointing the launcher at the resulting folder. The modal that
 * explains this is shown on first install and dismissed by an
 * explicit acknowledgement, so we remember that acknowledgement here
 * in localStorage.
 *
 * `clearSteamInstructionsSeen()` is wired into the game-state
 * `clearDirectory` path so users who wipe their install see the
 * instructions again on next launch — the prompt only re-arms on
 * explicit reset, not on every page reload.
 *
 * `localStorage` can throw in private-mode or sandboxed contexts, so
 * every helper is wrapped in try/catch and returns a safe default
 * (false / no-op). The launcher treats the flag as best-effort UX
 * state — losing it just means we'll show the modal one extra time.
 */

const STORAGE_KEY = 'zemu-launcher.steam-instructions-seen'

export const STEAM_INSTRUCTIONS_STORAGE_KEY = STORAGE_KEY

export function hasSeenSteamInstructions(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function markSteamInstructionsSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    /* best-effort — losing the flag just shows the modal again next launch */
  }
}

export function clearSteamInstructionsSeen(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* best-effort */
  }
}
