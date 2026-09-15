use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthToken {
    pub token: String,
    pub user_id: String,
    pub email: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub roles: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permissions: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthCallbackPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthState {
    pub state: String,
    pub provider: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AuthStore {
    #[serde(default)]
    pub token: Option<AuthToken>,
    #[serde(default)]
    pub oauth_states: HashMap<String, OAuthState>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DiscordRpcMode {
    Always,
    PlayingOnly,
    Never,
}

fn default_rpc_mode() -> DiscordRpcMode {
    DiscordRpcMode::Always
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AppTheme {
    System,
    Dark,
    Light,
}

fn default_theme() -> AppTheme {
    AppTheme::System
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WineEnvVar {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum WineRuntimeKind {
    Wine,
    Proton,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WineRuntime {
    pub id: String,
    pub name: String,
    pub kind: WineRuntimeKind,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WineConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub runtime_id: Option<String>,
    #[serde(default)]
    pub custom_runtime_path: Option<String>,
    #[serde(default)]
    pub wine_prefix: Option<String>,
    #[serde(default)]
    pub env: Vec<WineEnvVar>,
}

impl Default for WineConfig {
    fn default() -> Self {
        Self {
            enabled: cfg!(all(unix, not(target_os = "macos"))),
            runtime_id: None,
            custom_runtime_path: None,
            wine_prefix: None,
            env: vec![
                WineEnvVar {
                    key: "DXVK_ASYNC".to_string(),
                    value: "1".to_string(),
                },
                WineEnvVar {
                    key: "WINEDEBUG".to_string(),
                    value: "-all".to_string(),
                },
            ],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherConfig {
    #[serde(default)]
    pub game_directory: Option<String>,
    #[serde(default = "default_true")]
    pub auto_update: bool,
    #[serde(default)]
    pub last_update_check: Option<String>,
    #[serde(default)]
    pub update_base_url: Option<String>,
    #[serde(default)]
    pub api_base_url: Option<String>,
    #[serde(default)]
    pub oauth_callback_protocol: Option<String>,
    /// Path to the game executable inside `game_directory`. Defaults to
    /// `H1Z1.exe` at the root of the install.
    #[serde(default)]
    pub game_executable: Option<String>,
    /// Whether the Discord Rich Presence worker should publish
    /// activity. Defaults to `true` so the opt-out is the user's
    /// explicit choice.
    #[serde(default = "default_true")]
    pub discord_rpc_enabled: bool,
    /// Controls when Discord Rich Presence is visible. `always` shows
    /// presence in both the launcher and in-game; `playing-only` shows
    /// it only while the game is running; `never` is equivalent to
    /// disabling the feature entirely.
    #[serde(default = "default_rpc_mode")]
    pub discord_rpc_mode: DiscordRpcMode,
    /// App colour theme. `system` follows the OS preference.
    #[serde(default = "default_theme")]
    pub theme: AppTheme,
    /// The user's auth key — stored locally and passed as the
    /// `SessionId=` command-line argument at game launch. No server
    /// validation is performed on this value.
    #[serde(default)]
    pub auth_key: Option<String>,
    /// Game language override (lowercase `xx_yy` tag such as
    /// `en_us`, `fr_fr`, `zh_cn`). The launcher writes this into
    /// the game's own `[Internationalization] Locale=` block in
    /// `ClientConfig.ini` inside the install directory at launch
    /// time — that's where the game actually picks its in-game
    /// language. `None` means "fall back to the game's built-in
    /// default" — which today is `en_us`. The renderer is
    /// responsible for keeping this aligned with the
    /// `KNOWN_LOCALES` set it surfaces in the Properties pane.
    #[serde(default = "default_locale")]
    pub locale: Option<String>,
    #[serde(default)]
    pub wine: WineConfig,
}

impl Default for LauncherConfig {
    fn default() -> Self {
        Self {
            game_directory: None,
            auto_update: true,
            last_update_check: None,
            update_base_url: None,
            api_base_url: None,
            oauth_callback_protocol: None,
            game_executable: None,
            discord_rpc_enabled: true,
            discord_rpc_mode: DiscordRpcMode::Always,
            theme: AppTheme::System,
            auth_key: None,
            locale: default_locale(),
            wine: WineConfig::default(),
        }
    }
}

fn default_true() -> bool {
    true
}

/// Default game locale when the user hasn't picked one yet. Mirrors
/// the `en_us` fallback the game itself documents — we keep the
/// launcher's behavior consistent with "first launch = English".
fn default_locale() -> Option<String> {
    Some("en_us".to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManifestEntry {
    pub checksum: String,
    pub size: u64,
    pub compressed_size: u64,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderManifestEntry {
    #[serde(default)]
    pub checksum: Option<String>,
    #[serde(default, alias = "totalSize")]
    pub size: Option<u64>,
    #[serde(default, alias = "totalCompressedSize")]
    pub compressed_size: Option<u64>,
    #[serde(default)]
    pub file_count: u64,
    #[serde(default)]
    pub files: HashMap<String, FileManifestEntry>,
    /// Compression algorithm used for the archive that backs this folder
    /// or its files. Currently always `"zstd"`. Optional for backward
    /// compatibility with manifests that pre-date the field — an absent
    /// value is treated as `"zstd"`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compression: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionManifest {
    pub version: String,
    #[serde(default)]
    pub build: u64,
    pub release_date: String,
    #[serde(default)]
    pub changelog: Option<String>,
    pub folders: HashMap<String, FolderManifestEntry>,
    #[serde(default)]
    pub total_size: u64,
    #[serde(default)]
    pub total_compressed_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileUpdateItem {
    pub folder_name: String,
    pub file_path: String,
    pub entry: FileManifestEntry,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub has_update: bool,
    pub cdn_available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folders_to_update: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_to_update: Option<Vec<FileUpdateItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_file_level: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderProgress {
    pub folder_name: String,
    pub stage: String,
    pub progress: f64,
    pub downloaded: u64,
    pub total: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileProgress {
    pub file_path: String,
    pub stage: String,
    pub progress: f64,
    pub downloaded: u64,
    pub total: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub is_updating: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_folder: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_file: Option<String>,
    pub total_folders: usize,
    pub completed_folders: usize,
    pub total_files: usize,
    pub completed_files: usize,
    pub overall_progress: f64,
    pub folders: Vec<FolderProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files: Option<Vec<FileProgress>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Phase of a SteamCMD-driven depot download. Mirrors the high-level
/// phases the wizard's progress dialog renders.
///
/// `Downloading` and `Verifying` both come from SteamCMD itself;
/// `Flattening` is ours (moving files from the staging dir to the
/// user's chosen folder). `Done` is the terminal success state; `Error`
/// surfaces the last SteamCMD error line so the UI can render a
/// context-appropriate recovery CTA.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SteamcmdPhase {
    Downloading,
    Verifying,
    Flattening,
    Done,
    Error,
}

/// Progress event emitted from the Rust SteamCMD wrapper. The wizard's
/// `<DownloadProgressDialog />` listens for `steamcmd-progress` events
/// and forwards them into its props.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamcmdProgress {
    pub phase: SteamcmdPhase,
    /// 0..=100. Computed from `bytes_done / bytes_total` when known;
    /// falls back to a coarse estimate derived from SteamCMD's phase
    /// transitions otherwise.
    pub percent: u8,
    pub bytes_done: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes_total: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed_bps: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eta_seconds: Option<u64>,
    /// Surface this string in the dialog header. Typically used for
    /// error messages ("Disk write failure", "Steam Guard code
    /// required", etc).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Final result returned by `steamcmd_download_depot`. Carries the last
/// 4 KB of SteamCMD stdout in `log_tail` so support can diagnose
/// failures without re-running the process.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamcmdResult {
    pub final_dir: String,
    pub depot_bytes: u64,
    pub duration_ms: u64,
    pub log_tail: String,
}

/// Inputs to `steamcmd_download_depot`. `expected_bytes` is optional —
/// when supplied (typically from the launcher config or version
/// manifest), it's used to compute a percent progress bar; without it,
/// the UI falls back to an indeterminate spinner with byte counts.
#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepotSpec {
    pub app_id: u32,
    pub depot_id: u32,
    #[serde(default)]
    pub expected_bytes: Option<u64>,
}

impl Default for UpdateStatus {
    fn default() -> Self {
        Self {
            is_updating: false,
            current_folder: None,
            current_file: None,
            total_folders: 0,
            completed_folders: 0,
            total_files: 0,
            completed_files: 0,
            overall_progress: 0.0,
            folders: Vec::new(),
            files: None,
            error: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Optional state echoed back to the renderer. Currently used by
    /// `auth_open_oauth` so the renderer can correlate the eventual
    /// `oauth-callback` event with the flow it kicked off.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
}

impl CommandResult {
    pub fn ok() -> Self {
        Self {
            success: true,
            error: None,
            state: None,
        }
    }

    pub fn err(message: impl Into<String>) -> Self {
        Self {
            success: false,
            error: Some(message.into()),
            state: None,
        }
    }

    /// Convenience constructor for commands that need to return data to
    /// the renderer in addition to the success flag.
    pub fn ok_with_state(state: impl Into<String>) -> Self {
        Self {
            success: true,
            error: None,
            state: Some(state.into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GameLaunchState {
    pub is_launching: bool,
    pub is_running: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct WebSession {
    pub authenticated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<WebSessionUser>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct WebSessionUser {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(default)]
    pub roles: Vec<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adding_wine_preserves_existing_auth_key_and_settings() {
        let mut existing = serde_json::to_value(LauncherConfig::default()).unwrap();
        existing.as_object_mut().unwrap().remove("wine");
        existing["authKey"] = "local-auth-key".into();
        existing["gameDirectory"] = "/games/King of the Kill".into();
        existing["sessionIdEndpointUrl"] = "http://localhost:8081/custom".into();
        let mut config: LauncherConfig = serde_json::from_value(existing.clone()).unwrap();
        assert_eq!(config.wine, WineConfig::default());
        config.wine.runtime_id = Some("custom".into());
        config.wine.custom_runtime_path = Some("/opt/wine/bin/wine".into());
        let saved = serde_json::to_value(&config).unwrap();
        for (key, value) in existing.as_object().unwrap() {
            assert_eq!(&saved[key], value, "Wine must preserve {key}");
        }
        let mut reloaded: LauncherConfig = serde_json::from_value(saved).unwrap();
        reloaded.auth_key = Some("replacement-key".into());
        assert_eq!(reloaded.wine, config.wine);
    }
}
