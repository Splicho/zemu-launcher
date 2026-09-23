/**
 * Persistence for the "user has completed first-run onboarding" state.
 *
 * The flag lives in `LauncherConfig.onboarding_completed` on the Rust
 * side (`src-tauri/src/storage.rs`). We moved it out of localStorage so
 * the gate (`useOnboardingGate`) survives browser-data wipes, private
 * windows, and sandboxed contexts — the previous localStorage flag
 * would silently disappear on the user and then re-push them through
 * the wizard on the next launch even though their install was intact.
 *
 * Two consumers:
 *
 *   - `useOnboardingGate` calls `hasCompletedOnboarding()` once on
 *     mount to gate the wizard redirect.
 *   - `OnboardingPage`'s `finish` callback (and the install-check
 *     pre-screen's "Yes" branch) call `markOnboardingCompleted()`
 *     before flipping the hash, so the gate's next evaluation
 *     publishes `{ kind: 'complete' }` and the user lands on `/`.
 *
 * The flag is a hint, not a source of truth. The gate's Path 1
 * (`hasKey && hasFolder && hasBaseGame` all on disk) returns
 * `complete` regardless of the flag, so a wiped flag with a real
 * install still lets the user past `#/`. The Rust call is awaited
 * in dev mode it no-ops gracefully (`launcherAPI` is undefined in
 * plain Vite dev), so a missing Tauri runtime falls back to
 * "not completed" and the user sees the install-check screen like
 * a fresh install.
 */

export async function hasCompletedOnboarding(): Promise<boolean> {
  try {
    const value = await window.launcherAPI?.getOnboardingCompleted?.()
    return value === true
  } catch {
    /* Tauri raised — treat as "not completed" so the gate pushes the
       user through the install-check rather than silently skipping
       it (which would strand them on `/` with no install). */
    return false
  }
}

export async function markOnboardingCompleted(): Promise<void> {
  try {
    await window.launcherAPI?.setOnboardingCompleted?.(true)
  } catch {
    /* Best-effort — losing the flag means the gate falls through to
       on-disk checks on next mount, which still resolves to
       `complete` when the install is intact. */
  }
}

export async function clearOnboardingCompleted(): Promise<void> {
  try {
    await window.launcherAPI?.setOnboardingCompleted?.(false)
  } catch {
    /* best-effort — same rationale as the setter */
  }
}
