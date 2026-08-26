use crate::models::{AuthStore, LauncherConfig, VersionManifest};
use anyhow::{anyhow, Context, Result};
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const CONFIG_FILE: &str = "launcher-config.json";
const VERSION_FILE: &str = "game-version.json";
const AUTH_STORE_FILE: &str = "auth-store.json";

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

pub fn load_version_cache(app: &AppHandle) -> Result<Option<VersionManifest>> {
    let path = version_cache_path(app)?;
    if !path.exists() {
        return Ok(None);
    }

    match read_json::<VersionManifest>(&path) {
        Ok(version) => Ok(Some(version)),
        Err(_) => Ok(None),
    }
}

pub fn save_version_cache(app: &AppHandle, manifest: &VersionManifest) -> Result<()> {
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

pub fn detect_oauth_callback_protocol(app: &AppHandle) -> Result<Option<String>> {
    let launcher_config = load_launcher_config(app)?;
    if let Some(protocol) = launcher_config.oauth_callback_protocol {
        if let Some(normalized) = normalize_callback_protocol(&protocol) {
            return Ok(Some(normalized));
        }
    }

    Ok(None)
}

pub fn detect_api_base_url(app: &AppHandle) -> Result<Option<String>> {
    let launcher_config = load_launcher_config(app)?;
    if let Some(url) = launcher_config.api_base_url {
        let normalized = normalize_api_base_url(&url);
        if !normalized.is_empty() {
            return Ok(Some(normalized));
        }
    }

    Ok(None)
}

pub fn detect_game_executable(app: &AppHandle) -> String {
    load_launcher_config(app)
        .ok()
        .and_then(|config| config.game_executable)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "H1Z1.exe".to_string())
}

fn trim_base_url(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}

fn normalize_api_base_url(value: &str) -> String {
    let trimmed = trim_base_url(value);
    if let Some(without_api) = trimmed.strip_suffix("/api") {
        without_api.to_string()
    } else {
        trimmed
    }
}

pub fn normalize_callback_protocol(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut scheme = trimmed.to_string();
    if let Some((prefix, _)) = trimmed.split_once("://") {
        scheme = prefix.to_string();
    }

    let scheme = scheme.trim().trim_end_matches(':').trim_end_matches('/');
    if scheme.is_empty() {
        return None;
    }

    Some(format!("{scheme}://"))
}

pub fn is_packaged() -> bool {
    !cfg!(debug_assertions)
}
