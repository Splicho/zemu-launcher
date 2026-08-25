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

/// Steam login credentials persisted alongside the launcher config.
///
/// We keep both the username and a long-lived refresh token. The refresh
/// token is what `steamroom` uses to mint short-lived access tokens without
/// prompting the user again. The password is never persisted.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamCredentials {
    #[serde(default)]
    pub username: String,
    pub refresh_token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub steam_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_login_at: Option<i64>,
}

/// Phases for the `depot-progress` event stream. Mirrors the
/// `DownloadEvent` variants exposed by `steamroom-client`, flattened into a
/// serializable shape for the React UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepotProgress {
    pub phase: DepotPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_files: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_files: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub percent: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum DepotPhase {
    Started,
    LoggingIn,
    VerifyingOwnership,
    FetchingManifest,
    FileStarted,
    FileCompleted,
    ChunkProgress,
    Done,
    Failed,
    Cancelled,
}

impl DepotProgress {
    #[allow(dead_code)]
    pub fn started(total_bytes: u64, total_files: u64) -> Self {
        Self {
            phase: DepotPhase::Started,
            current_file: None,
            completed_bytes: Some(0),
            total_bytes: Some(total_bytes),
            completed_files: Some(0),
            total_files: Some(total_files),
            percent: Some(0.0),
            message: None,
            error: None,
        }
    }

    pub fn logging_in() -> Self {
        Self {
            phase: DepotPhase::LoggingIn,
            current_file: None,
            completed_bytes: None,
            total_bytes: None,
            completed_files: None,
            total_files: None,
            percent: None,
            message: Some("Connecting to Steam...".into()),
            error: None,
        }
    }

    #[allow(dead_code)]
    pub fn verifying_ownership() -> Self {
        Self {
            phase: DepotPhase::VerifyingOwnership,
            current_file: None,
            completed_bytes: None,
            total_bytes: None,
            completed_files: None,
            total_files: None,
            percent: None,
            message: Some("Verifying Steam ownership...".into()),
            error: None,
        }
    }

    pub fn fetching_manifest() -> Self {
        Self {
            phase: DepotPhase::FetchingManifest,
            current_file: None,
            completed_bytes: None,
            total_bytes: None,
            completed_files: None,
            total_files: None,
            percent: None,
            message: Some("Fetching depot manifest...".into()),
            error: None,
        }
    }

    pub fn file_started(filename: &str) -> Self {
        Self {
            phase: DepotPhase::FileStarted,
            current_file: Some(filename.to_string()),
            completed_bytes: None,
            total_bytes: None,
            completed_files: None,
            total_files: None,
            percent: None,
            message: None,
            error: None,
        }
    }

    #[allow(dead_code)]
    pub fn chunk_progress(
        current_file: Option<&str>,
        completed_bytes: u64,
        total_bytes: u64,
        completed_files: u64,
        total_files: u64,
    ) -> Self {
        let percent = if total_bytes > 0 {
            Some((completed_bytes as f64 / total_bytes as f64) * 100.0)
        } else {
            Some(0.0)
        };
        Self {
            phase: DepotPhase::ChunkProgress,
            current_file: current_file.map(|s| s.to_string()),
            completed_bytes: Some(completed_bytes),
            total_bytes: Some(total_bytes),
            completed_files: Some(completed_files),
            total_files: Some(total_files),
            percent,
            message: None,
            error: None,
        }
    }

    pub fn done() -> Self {
        Self {
            phase: DepotPhase::Done,
            current_file: None,
            completed_bytes: None,
            total_bytes: None,
            completed_files: None,
            total_files: None,
            percent: Some(100.0),
            message: Some("Depot download complete".into()),
            error: None,
        }
    }

    pub fn failed(error: impl Into<String>) -> Self {
        Self {
            phase: DepotPhase::Failed,
            current_file: None,
            completed_bytes: None,
            total_bytes: None,
            completed_files: None,
            total_files: None,
            percent: None,
            message: None,
            error: Some(error.into()),
        }
    }

    #[allow(dead_code)]
    pub fn cancelled() -> Self {
        Self {
            phase: DepotPhase::Cancelled,
            current_file: None,
            completed_bytes: None,
            total_bytes: None,
            completed_files: None,
            total_files: None,
            percent: None,
            message: Some("Depot download cancelled".into()),
            error: None,
        }
    }
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

/// Result of a password-based Steam login attempt.
///
/// `NeedsGuard` is not an error — it signals to the renderer that the user
/// must supply a Steam Guard code and retry. `Authenticated` carries the
/// persisted credentials on success.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum SteamLoginResult {
    /// Steam needs a Guard code. `can_use_mobile_approval` is true when
    /// Steam also accepts mobile-authenticator confirmation; the renderer
    /// can offer that as an alternative path.
    NeedsGuard {
        username: String,
        #[serde(default)]
        can_use_mobile_approval: bool,
    },
    /// Login succeeded. The credentials (with a fresh refresh token) are ready
    /// to be saved to disk.
    Authenticated(SteamCredentials),
    /// A genuine error occurred (bad password, network failure, etc.).
    Error { message: String },
}
