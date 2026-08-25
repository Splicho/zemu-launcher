//! Self-contained Steam depot download pipeline built on top of the
//! `steamroom` and `steamroom-client` crates. This module exists so the
//! launcher can download the H1Z1 base game from Steam's CDN without
//! requiring the user to have the Steam desktop client installed or
//! owning a Steamworks partner account.
//!
//! Public surface:
//!   * [`download_depot`] — orchestrate the full pipeline and emit
//!     `depot-progress` events to the renderer.

pub mod auth;
pub mod download;
pub mod progress;

use crate::debug_log;
use crate::models::{DepotProgress, SteamCredentials};
use anyhow::{anyhow, Result};
use std::path::PathBuf;
use steamroom::client::LoggedIn;
use steamroom::client::SteamClient;
use tauri::{AppHandle, Emitter};

/// Hard-coded H1Z1 Steam identifiers. Kept here so the front-end can pass
/// only `manifestId` and `depotId` while we still own the canonical
/// app/depot mapping.
pub const H1Z1_APP_ID: u32 = 433_850;
pub const H1Z1_DEFAULT_DEPOT_ID: u32 = 433_851;
pub const H1Z1_DEFAULT_MANIFEST_ID: u64 = 6_098_349_229_565_958_949;

pub const DEPOT_PROGRESS_EVENT: &str = "depot-progress";

/// Parameters supplied by the front-end when a user clicks Install. The
/// `output_dir` is the folder the user picked in the file dialog.
#[derive(Debug, Clone)]
pub struct DepotRequest {
    pub app_id: u32,
    pub depot_id: u32,
    pub manifest_id: u64,
    pub output_dir: PathBuf,
}

impl DepotRequest {
    #[allow(dead_code)]
    pub fn h1z1(output_dir: PathBuf) -> Self {
        Self {
            app_id: H1Z1_APP_ID,
            depot_id: H1Z1_DEFAULT_DEPOT_ID,
            manifest_id: H1Z1_DEFAULT_MANIFEST_ID,
            output_dir,
        }
    }
}

/// Outcome of a successful download. The refresh token may differ from what
/// the user originally typed (Steam rotates it on every successful auth).
/// Frontend stores this so subsequent launches can silently re-auth.
#[derive(Debug, Clone)]
pub struct DownloadOutcome {
    pub saved_credentials: Option<SteamCredentials>,
}

/// Spawn the full pipeline on the current Tokio runtime. This is what the
/// `game_download_depot` command calls.
pub async fn download_depot(
    app: AppHandle,
    credentials: SteamCredentials,
    request: DepotRequest,
) -> Result<DownloadOutcome> {
    let _ = debug_log::append(
        &app,
        "steam.download",
        &format!(
            "download_depot app={} depot={} manifest={} output={}",
            request.app_id,
            request.depot_id,
            request.manifest_id,
            request.output_dir.display()
        ),
    );

    emit_progress(&app, DepotProgress::logging_in());

    let (client, fresh_refresh_token) =
        auth::login(&app, credentials.clone())
            .await
            .map_err(|err| {
                let _ = debug_log::append(&app, "steam.download", &format!("login failed: {err}"));
                anyhow!("Steam login failed: {err}")
            })?;

    emit_progress(&app, DepotProgress::fetching_manifest());

    download::download_and_assemble(&app, &client, &request)
        .await
        .map_err(|err| {
            let _ = debug_log::append(&app, "steam.download", &format!("download failed: {err}"));
            anyhow!("Depot download failed: {err}")
        })?;

    emit_progress(&app, DepotProgress::done());

    let mut saved = credentials.clone();
    saved.refresh_token = fresh_refresh_token;
    saved.last_login_at = Some(chrono::Utc::now().timestamp());

    Ok(DownloadOutcome {
        saved_credentials: Some(saved),
    })
}

/// Helper for emitting structured progress events to the renderer.
pub(crate) fn emit_progress(app: &AppHandle, progress: DepotProgress) {
    let _ = app.emit(DEPOT_PROGRESS_EVENT, progress);
}

// `LoggedIn` is re-exported so downstream modules can spell the type
// parameter without depending on the steamroom crate directly.
#[allow(dead_code)]
pub type LoggedInClient = SteamClient<LoggedIn>;