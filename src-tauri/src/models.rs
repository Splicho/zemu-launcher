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
    pub code: Option<String>,
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
    /// PKCE code-verifier (RFC 7636). Stored alongside the state
    /// record so the launcher's exchange step can prove the
    /// authorization request came from the same caller that
    /// received the redirect.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code_verifier: Option<String>,
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
    /// Set to `true` once the user finishes the first-run wizard
    /// (or clicks "Yes, I already have it" on the install-check
    /// pre-screen). Persisted in `launcher-config.json` so it
    /// survives browser-data clears and private-mode sessions —
    /// the previous localStorage flag could be silently wiped and
    /// the user would get re-pushed through the wizard on the next
    /// launch. `false` (the `Default` value) means the gate still
    /// needs to confirm a valid install on disk before letting the
    /// user past `#/`.
    #[serde(default)]
    pub onboarding_completed: bool,
}

impl Default for LauncherConfig {
    fn default() -> Self {
        Self {
            game_directory: None,
            auto_update: true,
            last_update_check: None,
            update_base_url: None,
            api_base_url: None,
            game_executable: None,
            discord_rpc_enabled: true,
            discord_rpc_mode: DiscordRpcMode::Always,
            theme: AppTheme::System,
            auth_key: None,
            locale: default_locale(),
            wine: WineConfig::default(),
            onboarding_completed: false,
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

/// One file entry in the compressor manifest. `path` uses forward slashes
/// relative to the game install root. `hash` is the blake3 hex digest of
/// the original uncompressed bytes. `compressed_hash` is the SHA-256 hex
/// digest of the `.zst` payload (what the launcher downloads).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressorManifestEntry {
    pub path: String,
    pub size: u64,
    pub hash: String,
    pub compressed_size: u64,
    pub compressed_hash: String,
}

/// One file that was removed between the previous published manifest and
/// this one. `hash` is the blake3 hex digest of the file as it last
/// existed (for traceability — the launcher doesn't need to download a
/// delete).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovedEntry {
    pub path: String,
    pub size: u64,
    pub hash: String,
}

/// The compressor manifest. Produced by `tauri-compressor` and consumed
/// by the launcher's updater. Both sides serialize to the same JSON
/// shape (camelCase, identical field names).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressorManifest {
    pub version: String,
    #[serde(default)]
    pub files: Vec<CompressorManifestEntry>,
    #[serde(default)]
    pub removed: Vec<RemovedEntry>,
}

/// One item in `UpdateCheckResult.files_to_update`. The launcher only
/// deals with flat file paths — there is no folder-level concept
/// anymore.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileUpdateItem {
    pub path: String,
    pub entry: CompressorManifestEntry,
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
    pub files_to_update: Option<Vec<FileUpdateItem>>,
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
    pub current_file: Option<String>,
    pub total_files: usize,
    pub completed_files: usize,
    pub overall_progress: f64,
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
            current_file: None,
            total_files: 0,
            completed_files: 0,
            overall_progress: 0.0,
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
        existing["apiBaseUrl"] = "http://localhost:8081/custom".into();
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

// ─── Pre-launch integrity check ──────────────────────────────────────────
//
// Wire types for the on-demand patch integrity verification that runs
// when the user clicks Play. See `crate::integrity` for the
// implementation and `commands::game_verify_and_repair` for the IPC
// entry point.

/// Why a single manifest entry was reported as tampered. `SizeMismatch`
/// is collapsed into `HashMismatch` because a correct-size, wrong-content
/// file with the right blake3 hash is impossible — `SizeMismatch` would
/// only show up if a future field added size checking back, so the
/// variant is reserved for forward compatibility.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TamperReason {
    HashMismatch,
    Missing,
    SizeMismatch,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TamperedFile {
    pub path: String,
    pub reason: TamperReason,
    pub expected_blake3: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_blake3: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum VerifyStatus {
    /// All manifest entries match the on-disk blake3 hash. Safe to launch.
    Clean,
    /// Tampering was detected and successfully repaired by re-downloading
    /// the affected entries from the CDN. Safe to launch.
    Repaired,
    /// Tampering was detected but the CDN was unreachable, so the
    /// affected entries could not be replaced. The launch must be refused
    /// because we cannot prove the on-disk bytes are still authentic.
    TamperedCdnDown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyOutcome {
    pub status: VerifyStatus,
    pub tampered: Vec<TamperedFile>,
    /// True when the CDN was reachable during this check. `false`
    /// means either `update_base_url` was unset or the manifest fetch
    /// failed. Surfaced separately from `status == TamperedCdnDown` so
    /// the renderer can show a distinct "CDN is offline" toast on a
    /// clean-but-offline install.
    pub cdn_available: bool,
}

/// Per-file mtime/size cache used to skip the blake3 read on the common
/// "nothing has changed since last Play" path. Persisted as a sidecar
/// JSON file next to `manifest.json` (the manifest itself stays a
/// verbatim mirror of the CDN payload).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrityCache {
    pub entries: std::collections::HashMap<String, IntegrityCacheEntry>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IntegrityCacheEntry {
    /// File size in bytes at the time the cache entry was written.
    pub size: u64,
    /// File mtime in milliseconds since the unix epoch. We keep ms to
    /// dodge the 1-second resolution that NTFS exposes via
    /// `mtime`/`Modified` and which would collide on rapid edits.
    pub mtime_unix_ms: i64,
}

