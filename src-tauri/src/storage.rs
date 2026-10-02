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
        }
        return Ok(Some(value));
    }

    Ok(None)
}

/// Persist a new H1Z1 session key, replacing any existing one.
/// An empty / whitespace-only string clears the entry.
pub fn write_auth_key(app: &AppHandle, key: &str) -> Result<()> {
    let store = open_auth_key_store(app);
    if key.trim().is_empty() {
        let _ = store.delete(AUTH_KEY_ACCOUNT);
    } else {
        store
            .set_password(AUTH_KEY_ACCOUNT, key)
            .map_err(|e| anyhow!("writing auth key to OS keychain: {e}"))?;
    }
    // Also clear the plaintext field in `launcher-config.json`
    // so the key is never on disk in cleartext, even transiently.
    redact_auth_key_in_config(app)
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
}
