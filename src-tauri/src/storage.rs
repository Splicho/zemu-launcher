use crate::models::{AuthStore, CompressorManifest, LauncherConfig};
use anyhow::{anyhow, Context, Result};
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tauri_plugin_keyring_store::{KeyringExt, KeyringStore};

const CONFIG_FILE: &str = "launcher-config.json";
const VERSION_FILE: &str = "game-version.json";
const AUTH_STORE_FILE: &str = "auth-store.json";

/// Account name in the OS keychain for the persisted H1Z1
/// session-key string (the `SessionId=...` argument we hand
/// the game at launch).
///
/// Kept here rather than alongside the refresh-token constants in
/// `depot.rs` because the two tokens have independent life
/// cycles and are managed by different modules — the Steam
/// refresh token lives entirely inside `depot.rs`, the game
/// session key here.
const AUTH_KEY_ACCOUNT: &str = "zemu-launcher-auth-key";

pub fn ensure_app_data_dir(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| anyhow!(e.to_string()))?;
    fs::create_dir_all(&dir)
        .with_context(|| format!("failed to create app data dir: {}", dir.display()))?;
    Ok(dir)
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T> {
    let raw =
        fs::read_to_string(path).with_context(|| format!("failed reading {}", path.display()))?;
    let parsed = serde_json::from_str::<T>(&raw)
        .with_context(|| format!("failed parsing {}", path.display()))?;
    Ok(parsed)
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let raw = serde_json::to_string_pretty(value).context("failed serializing json")?;
    fs::write(path, raw).with_context(|| format!("failed writing {}", path.display()))?;
    Ok(())
}

pub fn launcher_config_path(app: &AppHandle) -> Result<PathBuf> {
    Ok(ensure_app_data_dir(app)?.join(CONFIG_FILE))
}

pub fn version_cache_path(app: &AppHandle) -> Result<PathBuf> {
    Ok(ensure_app_data_dir(app)?.join(VERSION_FILE))
}

pub fn auth_store_path(app: &AppHandle) -> Result<PathBuf> {
    Ok(ensure_app_data_dir(app)?.join(AUTH_STORE_FILE))
}

pub fn load_launcher_config(app: &AppHandle) -> Result<LauncherConfig> {
    let path = launcher_config_path(app)?;
    if !path.exists() {
        return Ok(LauncherConfig::default());
    }

    match read_json::<LauncherConfig>(&path) {
        Ok(config) => Ok(config),
        Err(_) => Ok(LauncherConfig::default()),
    }
}

pub fn save_launcher_config(app: &AppHandle, config: &LauncherConfig) -> Result<()> {
    let path = launcher_config_path(app)?;
    write_json(&path, config)
}

pub fn load_version_cache(app: &AppHandle) -> Result<Option<CompressorManifest>> {
    let path = version_cache_path(app)?;
    if !path.exists() {
        return Ok(None);
    }

    match read_json::<CompressorManifest>(&path) {
        Ok(version) => Ok(Some(version)),
        Err(_) => Ok(None),
    }
}

pub fn save_version_cache(app: &AppHandle, manifest: &CompressorManifest) -> Result<()> {
    let path = version_cache_path(app)?;
    write_json(&path, manifest)
}

pub fn load_auth_store(app: &AppHandle) -> Result<AuthStore> {
    let path = auth_store_path(app)?;
    if !path.exists() {
        return Ok(AuthStore::default());
    }

    match read_json::<AuthStore>(&path) {
        Ok(store) => Ok(store),
        Err(_) => Ok(AuthStore::default()),
    }
}

pub fn save_auth_store(app: &AppHandle, store: &AuthStore) -> Result<()> {
    let path = auth_store_path(app)?;
    write_json(&path, store)
}

// ─── H1Z1 session-key keyring storage ──────────────────────────────────
//
// Historically the H1Z1 game-session key (the `SessionId=...`
// argument passed on the game process command line at launch)
// was stored in plaintext inside `launcher-config.json`. That
// left a copy of the credential on disk in any user's app data
// directory — recoverable by anyone with file-system access.
//
// The OS keychain is the right home for this. We keep an
// in-config `auth_key` field as a migration carrier for one
// release (so existing users don't get re-prompted for their key
// after the update) and read the keyring first whenever a
// non-empty value is present there.

fn open_auth_key_store(app: &AppHandle) -> Arc<KeyringStore> {
    let plugin = app.keyring();
    Arc::clone(&plugin.store)
}

/// Read the persisted H1Z1 session key. Reads from the OS
/// keychain first; if the keychain has nothing (typical for a
/// fresh install or a user migrating from plaintext storage),
/// falls back to the `auth_key` field in `launcher-config.json`
/// AND migrates that value into the keychain so the next call
/// finds it there.
///
/// Returns `Ok(None)` when neither source has a value.
pub fn read_auth_key(app: &AppHandle) -> Result<Option<String>> {
    let store = open_auth_key_store(app);
    match store.get_password(AUTH_KEY_ACCOUNT) {
        Ok(Some(value)) if !value.trim().is_empty() => return Ok(Some(value)),
        Ok(_) => {}
        Err(err) => {
            let _ = crate::debug_log::append(
                app,
                "auth",
                &format!("read_auth_key: keyring error: {err}"),
            );
        }
    }

    // Migration: copy plaintext → keychain, then redact the
    // plaintext copy. Old users keep their session through the
    // update; new users never get one written to disk.
    //
    // This is also the self-heal path for a machine whose credential
    // store was broken when `write_auth_key` fell back to the config
    // file (see that function's doc comment). If the keychain has
    // recovered by the time we read, the value migrates back and the
    // cleartext copy is dropped again — no user action required.
    let config = load_launcher_config(app)?;
    if let Some(value) = config.auth_key.as_ref().filter(|v| !v.trim().is_empty()) {
        let value = value.clone();
        if let Err(err) = store.set_password(AUTH_KEY_ACCOUNT, &value) {
            let _ = crate::debug_log::append(
                app,
                "auth",
                &format!("read_auth_key: keyring migration write failed: {err}"),
            );
            // Still return the value — the user just won't have
            // the next call hit the fast path. Don't fail the
            // launch on a keychain-only failure.
        } else {
            let _ = redact_auth_key_in_config(app);
            let _ = crate::debug_log::append(
                app,
                "auth",
                "read_auth_key: migrated auth key back into the keychain",
            );
        }
        return Ok(Some(value));
    }

    Ok(None)
}

/// Persist a new H1Z1 session key, replacing any existing one.
/// An empty / whitespace-only string clears the entry.
///
/// ## Why this has a plaintext fallback
///
/// The keychain write used to be the *only* place the key was
/// stored, and any failure there was returned as a hard `Err`. On
/// Windows that maps to the Credential Manager
/// (`windows-native-keyring-store`), which can be unavailable or
/// locked under a restricted / roaming profile, blocked by
/// enterprise policy or third-party security software, or hold a
/// corrupted blob for the `uk.zemu.launcher` service from an older
/// build. In every one of those cases the user was **locked out of
/// the game with no way forward**: `df68a71` removed the last
/// alternative entry point (`AuthKeyModal` on the account page and
/// the game action button), leaving onboarding Step 1 as the only
/// place a key can be entered — and Step 1's only save button calls
/// straight into this function.
///
/// A user reported exactly that: an empty input reading
/// "We could not load your saved key automatically (save_failed)",
/// and "Could not save the auth key" when pasting one manually.
///
/// ## The posture we take
///
/// This is deliberately the **same** trade-off `read_auth_key`
/// already makes, whose comment reads *"Don't fail the launch on a
/// keychain-only failure."* Reads degrade; writes now degrade too.
/// The asymmetry was the bug.
///
/// The fallback is failure-only, so a healthy machine never writes
/// the key in cleartext and the security win of the keyring is
/// preserved for every user whose credential store works. It is also
/// **self-healing**: the next `read_auth_key` finds the plaintext
/// value, re-attempts the keychain write, and on success calls
/// `redact_auth_key_in_config` to remove it again. A user whose
/// credential store recovers therefore silently migrates back on the
/// next launch.
pub fn write_auth_key(app: &AppHandle, key: &str) -> Result<()> {
    let store = open_auth_key_store(app);
    let key = key.trim();

    if key.is_empty() {
        let _ = store.delete(AUTH_KEY_ACCOUNT);
        return redact_auth_key_in_config(app);
    }

    match store.set_password(AUTH_KEY_ACCOUNT, key) {
        Ok(()) => {
            // Keychain is healthy — make sure no cleartext copy
            // lingers from an earlier failed write.
            redact_auth_key_in_config(app)
        }
        Err(err) => {
            // The old code returned `Err` here with no log line at
            // all, which made the failure undiagnosable from a user
            // report. Always record the real reason.
            let _ = crate::debug_log::append(
                app,
                "auth",
                &format!("write_auth_key: keyring write failed, falling back to config: {err}"),
            );

            // Persist to `launcher-config.json` so a broken OS
            // credential store can't lock the user out of the game.
            let mut config = load_launcher_config(app)?;
            config.auth_key = Some(key.to_string());
            save_launcher_config(app, &config)
        }
    }
}

/// Drop the plaintext `auth_key` field from `launcher-config.json`.
///
/// Called from both `read_auth_key` (after a successful migration
/// to the keychain) and `write_auth_key` (so the new write path
/// leaves nothing in the cleartext file).
fn redact_auth_key_in_config(app: &AppHandle) -> Result<()> {
    let mut config = load_launcher_config(app)?;
    if config.auth_key.is_some() {
        config.auth_key = None;
        save_launcher_config(app, &config)?;
    }
    Ok(())
}

/// Read the first-run onboarding completed flag from the persisted
/// `LauncherConfig`. Default `false` on first run or when the
/// file has not been written yet — that's also the right answer
/// for the gate (`useOnboardingGate` falls through to the on-disk
/// checks before trusting the flag).
pub fn has_completed_onboarding(app: &AppHandle) -> Result<bool> {
    let config = load_launcher_config(app)?;
    Ok(config.onboarding_completed)
}

/// Persist the first-run onboarding completed flag. Mirrors the
/// simple setter pattern used by `launcher_set_locale` —
/// load → mutate → save — so a concurrent write from another
/// command still resolves to the latest file contents on reload.
pub fn mark_onboarding_completed(app: &AppHandle, completed: bool) -> Result<()> {
    let mut config = load_launcher_config(app)?;
    config.onboarding_completed = completed;
    save_launcher_config(app, &config)
}


pub fn detect_game_executable(app: &AppHandle) -> String {
    load_launcher_config(app)
        .ok()
        .and_then(|config| config.game_executable)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "H1Z1.exe".to_string())
}

/// Marker file written by `steamcmd_download_depot` once a SteamCMD
/// auto-download successfully flattens into the user's chosen folder.
///
/// The marker is the source of truth for "Zemu knows about this
/// install and the auto-download flow ran successfully". The wizard's
/// Step 3 skips itself when this is present (no point re-downloading
/// a 15 GB depot that the launcher already pulled).
pub const ZEMU_INSTALL_MARKER: &str = ".zemu-install-v1";
pub const ZEMU_INSTALL_EXECUTABLE: &str = "H1Z1.exe";

/// Returns `true` if both the Zemu marker file AND `H1Z1.exe` exist at
/// the directory root. Used by the wizard to detect a previously-
/// completed auto-download and skip Step 3.
///
/// Note: a user who manually dropped a PS3 folder into the directory
/// (without going through SteamCMD) will have `H1Z1.exe` but NOT the
/// marker — that's a separate UI path ("looks like a manually-downloaded
/// install, but it's a Zemu-known folder"). The wizard's `setup-checks`
/// distinguishes these two cases via `hasMarker` vs `hasBaseGame`.
pub fn detect_base_game_installed(directory: &str) -> Result<bool> {
    let path = Path::new(directory);
    if !path.exists() || !path.is_dir() {
        return Ok(false);
    }

    let marker = path.join(ZEMU_INSTALL_MARKER);
    let exe = path.join(ZEMU_INSTALL_EXECUTABLE);

    Ok(marker.exists() && exe.is_file())
}

/// Write the `.zemu-install-v1` marker into `directory` after a
/// successful auto-download.
///
/// ## Why this exists
///
/// `detect_base_game_installed` (above) has treated the marker as the
/// source of truth for "the Zemu auto-download ran successfully" since
/// the SteamCMD path landed — but **nothing ever created the file**.
/// A repo-wide search for `zemu-install-v1` turned up only the
/// constant, the reader, and doc comments; there was no writer. Every
/// user who completed the depot download therefore reported
/// `hasMarker: false` forever after, which made `setup-checks.ts` fall
/// through to the bare `H1Z1.exe` probe for `hasBaseGame` and tagged
/// their install as `(manual)` in the wizard's Finish checklist.
///
/// Worse, the manifest fallback is not guaranteed: the depot's file
/// layout only puts `H1Z1.exe` at the folder root for the *base game*
/// depot, and `persist_installed_manifest_from_cdn` can fail outright
/// when the patch CDN is unreachable. In that case `hasBaseGame` reads
/// `false`, `decideOnboardingGate` returns `incomplete`, and
/// `AuthedApp`'s redirect effect shoves the user back into Step 3
/// ("Sign in with Steam") even though the 15 GB download is sitting on
/// disk complete. That is the exact loop reported by a user.
///
/// ## Contract
///
/// Called only after the download completes successfully and
/// `manifest.json` has been written. Cheap, idempotent, and
/// best-effort — a failure here is logged, never fatal, because the
/// install itself is valid and the play page's `isInstalled()` (which
/// keys off `manifest.json`) is the authoritative signal anyway.
pub fn write_install_marker(directory: &std::path::Path) -> Result<()> {
    let marker = directory.join(ZEMU_INSTALL_MARKER);
    // A short fixed stamp is plenty — nothing reads it back, it only
    // has to exist. `SystemTime` keeps this free of a new dependency.
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default();
    std::fs::write(&marker, format!("zemu-install-v1 {stamp}\n"))
        .with_context(|| format!("writing install marker {}", marker.display()))?;
    Ok(())
}

/// Lightweight path check exposed to the frontend via the
/// `game_path_exists` IPC. Used by `setup-checks.ts` to detect a
/// manually-dropped `H1Z1.exe` at the folder root, which has no
/// marker file and would otherwise look like an empty folder to the
/// launcher's `isInstalled()` check.
pub fn path_exists(path: &str) -> Result<bool> {
    Ok(Path::new(path).exists())
}

pub fn is_packaged() -> bool {
    if cfg!(debug_assertions) {
        return false;
    }

    // A Linux release executable built with --no-bundle is still a local
    // build. The updater otherwise replaces it with the published AppImage,
    // discarding local fixes. Tauri stamps this marker when creating a bundle.
    #[cfg(target_os = "linux")]
    {
        tauri::utils::platform::bundle_type().is_some()
    }
    #[cfg(not(target_os = "linux"))]
    {
        true
    }
}

pub fn launcher_updates_enabled() -> bool {
    should_check_launcher_updates(
        is_packaged(),
        std::env::var_os("ZEMU_DISABLE_SELF_UPDATE").as_deref(),
    )
}

fn should_check_launcher_updates(packaged: bool, disabled: Option<&std::ffi::OsStr>) -> bool {
    packaged && disabled != Some(std::ffi::OsStr::new("1"))
}

#[cfg(test)]
mod tests {
    /// The keychain account name is the only thing tying a saved auth
    /// key to this launcher on Windows' Credential Manager. If it
    /// changes, every existing user's saved key becomes invisible —
    /// they would silently re-enter it and, worse, a stale value
    /// would be left behind in the store. `REFRESH_TOKEN_ACCOUNT` in
    /// `depot.rs` must stay distinct so the two don't collide.
    #[test]
    fn auth_key_account_name_is_stable() {
        assert_eq!(super::AUTH_KEY_ACCOUNT, "zemu-launcher-auth-key");
    }

    /// A key that trims to empty must be treated as a clear, not
    /// stored. `write_auth_key` branches on this before touching the
    /// keychain, so a whitespace-only paste can't leave a junk
    /// credential behind.
    #[test]
    fn whitespace_only_key_normalizes_to_empty() {
        for raw in ["", " ", "\t", "\n", "  \r\n\t "] {
            assert!(
                raw.trim().is_empty(),
                "{raw:?} should normalize to a clear operation"
            );
        }
        assert!(!" ZEMU-KEY-123 ".trim().is_empty());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn unbundled_linux_executable_skips_updates() {
        // Run with cargo test --release too: debug_assertions alone used to
        // hide this bug. Cargo test executables have no Tauri bundle marker.
        assert!(!super::is_packaged());
    }

    #[test]
    fn packaged_launcher_can_skip_updates_for_local_testing() {
        use std::ffi::OsStr;
        assert!(super::should_check_launcher_updates(true, None));
        assert!(super::should_check_launcher_updates(
            true,
            Some(OsStr::new("0"))
        ));
        assert!(!super::should_check_launcher_updates(
            true,
            Some(OsStr::new("1"))
        ));
        assert!(!super::should_check_launcher_updates(false, None));
        assert!(!super::should_check_launcher_updates(
            false,
            Some(OsStr::new("0"))
        ));
    }

    /// Regression test for the silent "onboarding never completes"
    /// bug: `.zemu-install-v1` was read by
    /// `detect_base_game_installed` but written by *nothing*, so a
    /// user who had just finished a 15 GB depot download still
    /// reported `hasMarker: false` / `hasBaseGame: false`, the gate
    /// evaluated to `incomplete`, and they were pushed straight back
    /// into the wizard's Step 3 "Sign in with Steam" card.
    ///
    /// `write_install_marker` + `detect_base_game_installed` must
    /// round-trip once `H1Z1.exe` is present.
    #[test]
    fn install_marker_round_trips_with_executable_present() {
        let dir = std::env::temp_dir().join(format!(
            "zemu-marker-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::create_dir_all(&dir).expect("create temp install dir");

        // Bare directory: neither marker nor executable, so the
        // detector must say "no" even after the marker lands.
        super::write_install_marker(&dir).expect("write marker");
        assert!(
            !super::detect_base_game_installed(&dir.to_string_lossy())
                .expect("detect"),
            "marker alone is not enough — H1Z1.exe must also exist"
        );

        std::fs::write(dir.join(super::ZEMU_INSTALL_EXECUTABLE), b"MZ").expect("write exe");
        assert!(
            super::detect_base_game_installed(&dir.to_string_lossy()).expect("detect"),
            "marker + executable must report an installed base game"
        );

        // Idempotent: a second write (e.g. a re-run of the depot
        // install) must not error.
        super::write_install_marker(&dir).expect("rewrite marker");
        assert!(super::detect_base_game_installed(&dir.to_string_lossy()).expect("detect"));

        std::fs::remove_dir_all(&dir).ok();
    }
}
