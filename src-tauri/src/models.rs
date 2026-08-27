use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseRecord {
    pub license_key: String,
    pub pc_identifier: String,
    pub bound_at: i64,
    pub validated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub discord_user_id: Option<String>,
}

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
        }
    }
}

fn default_true() -> bool {
    true
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
