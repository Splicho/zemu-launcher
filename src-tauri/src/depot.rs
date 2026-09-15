//! Steam login + depot download — pure Rust, single module.
//!
//! This module is the only place that talks to Steam. Every Steam
//! flow the launcher needs goes through one of the four entry points
//! below:
//!
//! - [`login_qr`] — QR-code login; renders the challenge URL as a
//!   PNG data URL, drives the approval poll, returns the new refresh
//!   token.
//! - [`login_with_stored_token`] — re-use a refresh token already
//!   stored in the OS keychain.
//! - [`download_depot`] — install the game files (depot) into a
//!   user-chosen destination directory.
//! - [`start_scan_and_go`] — QR login + depot download in one
//!   fire-and-forget thread, the wizard's primary entry point.
//!
//! Under the hood this is a thin orchestrator on top of
//! [`steamroom`] and [`steamroom_client`], which are the
//! clean-room Rust reimplementations of SteamKit2 + DepotDownloader
//! used by the [`steamroom-cli`](https://crates.io/crates/steamroom-cli)
//! project. They implement the canonical SteamKit2 flow
//! (PICS access tokens → product info → depot key → CDN server
//! list → manifest request code → CDN auth token → manifest fetch
//! → pipelined chunk download with CDN server pool rotation, retry,
//! and SHA-1 verification), so we don't write any of that ourselves.
//!
//! ## Tauri event surface (preserved from the previous bridge)
//!
//! The React wizard subscribes to these Tauri events; we emit the
//! exact same names and payload shapes:
//!
//! - `steam-qr`           — `String` data URL (`data:image/png;base64,…`)
//! - `steam-scanned`      — `()` (user scanned the QR)
//! - `steam-authed`       — `String` account name
//! - `steam-error`        — `String` error message
//! - `depot-progress`     — `{ stage, message, bytesDone, bytesTotal,
//!                           speedBps, etaSeconds }`
//! - `depot-done`         — `{ finalDir, bytes }`
//! - `depot-error`        — `String` error message
//!
//! ## Token storage
//!
//! Refresh tokens live in the OS keychain via
//! `tauri-plugin-keyring-store`. The account name lives in
//! `<app_local_data_dir>/steam-account.json` so the wizard can
//! display it without an IPC round-trip. Tokens never cross an IPC
//! boundary — only `authed: bool` + `account_name` do.

use crate::debug_log;
use crate::models::SteamcmdResult;

use anyhow::{anyhow, Context, Result};
use base64::Engine as _;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use steamroom::cdn::{CdnClient, CdnServer, CdnServerPool};
use steamroom::connection::Protocol;
use steamroom::depot::manifest::DepotManifest;
use steamroom::depot::{AppId, CellId, DepotId, ManifestId};
use steamroom_client::download::{CdnChunkFetcher, DepotJob};
use steamroom_client::event::DownloadEvent;
use steamroom_client::login::LoginBuilder;
use steamroom_client::manifest::ManifestCache;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_keyring_store::{KeyringExt, KeyringStore};
use tokio::sync::mpsc;

// ---------------------------------------------------------------------------
// App / depot IDs.
//
// Single-purpose launcher for H1Z1. Bumping these to a second game
// means turning these into arguments — until then they live here.
// ---------------------------------------------------------------------------

const STEAM_APP_ID: u32 = 433_850;
const STEAM_DEPOT_ID: u32 = 433_851;
/// Public-branch manifest for the base-game depot. SteamDB / app
/// config can supply a fresher one on demand; this is the default
/// the wizard falls back to.
const STEAM_MANIFEST_ID: u64 = 6_098_349_229_565_958_949;
const STEAM_BRANCH: &str = "public";

// ---------------------------------------------------------------------------
// Tauri event names. Public so `commands.rs` can describe the same
// surface in its doc comments and `tauri-bridge.ts` (TS) can keep
// its existing string literals without a translation step.
// ---------------------------------------------------------------------------

pub const STEAM_QR_EVENT: &str = "steam-qr";
pub const STEAM_SCANNED_EVENT: &str = "steam-scanned";
pub const STEAM_AUTHED_EVENT: &str = "steam-authed";
pub const STEAM_ERROR_EVENT: &str = "steam-error";
pub const DEPOT_PROGRESS_EVENT: &str = "depot-progress";
pub const DEPOT_DONE_EVENT: &str = "depot-done";
pub const DEPOT_ERROR_EVENT: &str = "depot-error";

// ---------------------------------------------------------------------------
// Keychain account names. One entry per token type; the wizard
// never sees the values, only `authed: bool`.
// ---------------------------------------------------------------------------

const REFRESH_TOKEN_ACCOUNT: &str = "steam.refresh_token";

// ---------------------------------------------------------------------------
// Status surface for the wizard.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamAuthStatus {
    pub authed: bool,
    pub account_name: Option<String>,
}

/// `true` if a refresh token is present in the keychain. The
/// wizard's "is the bridge installed?" probe — always `true`
/// because there's no longer a separate sidecar to install.
pub fn is_available(_app: &AppHandle) -> bool {
    true
}

pub fn get_status(app: &AppHandle) -> SteamAuthStatus {
    match read_refresh_token(app) {
        Ok(Some(_)) => SteamAuthStatus {
            authed: true,
            account_name: read_account_name(app),
        },
        _ => SteamAuthStatus {
            authed: false,
            account_name: None,
        },
    }
}

pub fn cancel(_app: &AppHandle) {
    // QR + downloads run to completion on a dedicated thread; the
    // wizard's "cancel" button now flips the React side back to the
    // idle state and ignores further events.
}

pub fn logout(app: &AppHandle) -> Result<()> {
    clear_refresh_token(app)?;
    if let Ok(dir) = app.path().app_local_data_dir() {
        let _ = std::fs::remove_file(dir.join("steam-account.json"));
    }
    let _ = debug_log::append(app, "steam", "logout");
    Ok(())
}

// ---------------------------------------------------------------------------
// Public entry points called by `commands.rs`.
// ---------------------------------------------------------------------------

/// Begin the QR login flow alone (no download). Kept for symmetry;
/// the wizard's primary path is [`start_scan_and_go`].
pub fn login_qr(app: AppHandle) -> Result<()> {
    let _ = debug_log::append(&app, "steam", "login_qr_begin");
    let app_for_thread = app.clone();
    std::thread::spawn(move || {
        let rt = match tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .worker_threads(2)
            .build()
        {
            Ok(rt) => rt,
            Err(e) => {
                emit_error(&app_for_thread, &format!("tokio runtime: {e}"));
                return;
            }
        };
        rt.block_on(async move {
            match drive_qr(&app_for_thread).await {
                Ok(tokens) => persist_login(&app_for_thread, &tokens),
                Err(e) => {
                    let _ = debug_log::append(
                        &app_for_thread,
                        "steam",
                        &format!("login_qr_failed: {e:#}"),
                    );
                    emit_error(&app_for_thread, &format!("{e:#}"));
                }
            }
        });
    });
    Ok(())
}

/// Scan-and-go: QR login + depot download on the same runtime.
/// Returns immediately after spawning the worker thread; the React
/// UI keeps painting the QR while the user opens Steam Mobile.
pub fn start_scan_and_go(app: AppHandle, dest_dir: PathBuf) -> Result<()> {
    let _ = debug_log::append(
        &app,
        "steam",
        &format!("scan_and_go_begin dest={}", dest_dir.display()),
    );
    let app_for_thread = app.clone();
    std::thread::spawn(move || {
        let rt = match tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .worker_threads(4)
            .build()
        {
            Ok(rt) => rt,
            Err(e) => {
                emit_error(&app_for_thread, &format!("tokio runtime: {e}"));
                return;
            }
        };
        rt.block_on(async move {
            // 1. QR login.
            let tokens = match drive_qr(&app_for_thread).await {
                Ok(t) => t,
                Err(e) => {
                    let _ = debug_log::append(
                        &app_for_thread,
                        "steam",
                        &format!("scan_and_go_qr_failed: {e:#}"),
                    );
                    emit_error(&app_for_thread, &format!("{e:#}"));
                    return;
                }
            };
            persist_login(&app_for_thread, &tokens);

            // 2. Depot download using the freshly-minted tokens.
            if let Err(e) = drive_download(
                &app_for_thread,
                tokens.refresh_token,
                &dest_dir,
                None,
            )
            .await
            {
                let _ = debug_log::append(
                    &app_for_thread,
                    "steam",
                    &format!("scan_and_go_download_failed: {e:#}"),
                );
                emit_depot_error(&app_for_thread, &format!("{e:#}"));
            }
        });
    });
    Ok(())
}

/// Run the depot download only, using the stored refresh token.
/// Used when a returning user already has a token — no second QR.
pub async fn download_depot(
    app: AppHandle,
    dest_dir: PathBuf,
) -> Result<SteamcmdResult> {
    let started_at = Instant::now();
    let refresh_token = read_refresh_token(&app)?
        .ok_or_else(|| anyhow!("not signed in; run the QR gate first"))?;
    let account_name = read_account_name(&app).unwrap_or_default();
    let _ = debug_log::append(
        &app,
        "steam",
        &format!(
            "download_begin dest={} account={account_name}",
            dest_dir.display()
        ),
    );
    let total = drive_download(&app, refresh_token, &dest_dir, Some(account_name))
        .await
        .map_err(|e| {
            let _ = debug_log::append(&app, "steam", &format!("download error: {e:#}"));
            anyhow!("depot download failed: {e:#}")
        })?;
    let _ = debug_log::append(
        &app,
        "steam",
        &format!(
            "download_success bytes={} duration_ms={}",
            total,
            started_at.elapsed().as_millis()
        ),
    );
    Ok(SteamcmdResult {
        final_dir: dest_dir.to_string_lossy().to_string(),
        depot_bytes: total,
        duration_ms: started_at.elapsed().as_millis() as u64,
        log_tail: String::new(),
    })
}

// ---------------------------------------------------------------------------
// Drive functions — each owns a single SteamKit2 phase and emits
// the matching Tauri events. Splitting them keeps the QR path and
// the download path testable in isolation.
// ---------------------------------------------------------------------------

/// Run the full QR flow: connect to a CM, ask for a challenge URL,
/// render the QR as a PNG data URL, emit `steam-qr`, poll until
/// the user approves on their phone, emit `steam-scanned` then
/// `steam-authed` with the resulting tokens.
async fn drive_qr(app: &AppHandle) -> Result<steamroom::auth::AuthTokens> {
    let qr_flow = LoginBuilder::new()
        .device_name("ZEmu Launcher")
        .prefer_protocol(Protocol::Tcp)
        .allow_protocol_fallback(true)
        .with_qr()
        .begin()
        .await
        .context("starting QR auth session")?;

    let data_url = render_qr_data_url(qr_flow.challenge_url())
        .context("rendering QR code")?;
    let _ = app.emit(STEAM_QR_EVENT, data_url);
    let _ = debug_log::append(app, "steam", "qr_rendered");

    let approved = qr_flow
        .wait_for_scan()
        .await
        .context("waiting for phone approval")?;
    let tokens = approved.tokens().clone();
    let account_name = tokens.account_name.clone().unwrap_or_default();
    let _ = app.emit(STEAM_SCANNED_EVENT, ());
    let _ = app.emit(STEAM_AUTHED_EVENT, account_name);
    Ok(tokens)
}

/// Discover the app's metadata, fetch the depot key, the CDN server
/// list, the manifest, and run `DepotJob` against it. Streams
/// `depot-progress` events as files complete. Returns the total
/// bytes downloaded.
async fn drive_download(
    app: &AppHandle,
    refresh_token: String,
    dest_dir: &std::path::Path,
    account_name_hint: Option<String>,
) -> Result<u64> {
    let account_name = account_name_hint
        .or_else(|| read_account_name(app))
        .unwrap_or_default();
    if account_name.is_empty() {
        return Err(anyhow!(
            "no account name stored alongside the refresh token; \
             sign in once with the QR flow before retrying"
        ));
    }

    emit_progress(app, "login", "logging in to Steam", 0, 0, 0.0, 0.0);

    // 1. Open a logged-in CM session using the stored refresh token.
    //    `LoginBuilder::with_refresh_token(...).login()` returns
    //    `SteamClient<LoggedIn>` directly on success — no Option
    //    wrapper.
    let client = LoginBuilder::new()
        .device_name("ZEmu Launcher")
        .prefer_protocol(Protocol::Tcp)
        .allow_protocol_fallback(true)
        .with_refresh_token(&account_name, &refresh_token)
        .login()
        .await
        .context("opening CM session")?;
    let _ = debug_log::append(app, "steam", "cm_logged_in");

    emit_progress(app, "login", "logged in", 0, 0, 0.0, 0.0);

    let app_id = AppId(STEAM_APP_ID);
    let depot_id = DepotId(STEAM_DEPOT_ID);
    let manifest_id = ManifestId(STEAM_MANIFEST_ID);

    // 2. Depot decryption key. `steamroom` enforces ownership on the
    //    CM session; failure here means the account doesn't own H1Z1.
    emit_progress(app, "manifest", "fetching depot key", 0, 0, 0.0, 0.0);
    let depot_key = client
        .get_depot_decryption_key(depot_id, app_id)
        .await
        .context("fetching depot decryption key")?;

    // 3. CDN server list. The pool rotates across all of them on a
    //    failed request — exactly the fix the old single-server
    //    approach was missing (Steam's directory returns internal
    //    Valve hosts that don't resolve publicly in the top of the
    //    list, sorted by reported load 0).
    emit_progress(app, "manifest", "discovering CDN servers", 0, 0, 0.0, 0.0);
    let cdn_servers: Vec<CdnServer> = client
        .get_cdn_servers(CellId(0), Some(20))
        .await
        .context("discovering CDN servers")?;
    if cdn_servers.is_empty() {
        return Err(anyhow!("Steam returned no CDN servers for this account"));
    }

    // 4. Manifest request code. Old manifests (pre-2024) require
    //    one; the H1Z1 public-branch manifest usually does too.
    let request_code = match client
        .get_manifest_request_code(app_id, depot_id, manifest_id, Some(STEAM_BRANCH), None)
        .await
    {
        Ok(Some(code)) => code,
        Ok(None) => 0,
        Err(e) => {
            // The CLI treats this as a soft warning and continues —
            // public-branch downloads sometimes succeed without one.
            let _ = debug_log::append(
                app,
                "steam",
                &format!("manifest request code unavailable ({e:#}); trying without"),
            );
            0
        }
    };

    // 5. CDN auth token (optional).
    //
    //    Steam 3.0 moved `GetCDNAuthToken` from `SteamApps` to
    //    `ContentServerDirectory` and **added per-server
    //    `allowed_app_ids` filtering** — any server whose allowed
    //    list doesn't include our app id returns `eresult = Fail`
    //    regardless of account ownership. For H1Z1's public-branch
    //    depot (manifest 6098...949, vintage 2017), the token is
    //    not actually required: pre-Steam-3.0 depots are served
    //    anonymously, and `download_manifest_pooled` accepts
    //    `cdn_auth_token: None`. Treating the token request as a
    //    hard gate would lock out exactly this kind of legacy
    //    depot. So we try the pool, capture any token we get, and
    //    continue with `None` if every server refused — the
    //    downstream CDN call will surface a real 401/403 if a
    //    token genuinely *is* needed.
    emit_progress(
        app,
        "manifest",
        "requesting CDN auth token",
        0,
        0,
        0.0,
        0.0,
    );
    let mut cdn_auth_token: Option<String> = None;
    let mut last_auth_err: Option<String> = None;
    for (i, server) in cdn_servers.iter().enumerate() {
        match client
            .get_cdn_auth_token(app_id, depot_id, &server.host)
            .await
        {
            Ok(tok) => {
                let _ = debug_log::append(
                    app,
                    "steam",
                    &format!(
                        "cdn_auth_token_ok host={} attempt={}",
                        server.host, i
                    ),
                );
                cdn_auth_token = tok.token;
                break;
            }
            Err(e) => {
                let msg = format!(
                    "cdn_auth_token_fail host={} attempt={} err={e:#}",
                    server.host, i
                );
                let _ = debug_log::append(app, "steam", &msg);
                last_auth_err = Some(msg);
            }
        }
    }
    let cdn_auth_token = match cdn_auth_token {
        Some(t) if !t.is_empty() => Some(t),
        // No token obtained — not necessarily fatal. Steam 3.0's
        // server-side `allowed_app_ids` filter makes every
        // `GetCDNAuthToken` call fail for legacy depots whose app
        // id isn't on any returned server's allowlist. The H1Z1
        // base-game depot is exactly such a legacy depot and
        // downloads fine without a token. Fall through with
        // `None`; `download_manifest_pooled` will report a clean
        // 401/403 if a token actually *is* required.
        _ => {
            if let Some(detail) = last_auth_err.as_ref() {
                let _ = debug_log::append(
                    app,
                    "steam",
                    &format!(
                        "cdn_auth_token_skipped reason=no_token_from_any_server \
                         servers={} last_error={detail}",
                        cdn_servers.len(),
                    ),
                );
            }
            None
        }
    };

    // 6. Manifest cache: avoid re-downloading a manifest we already
    //    have on disk. Stored under the launcher's local data dir.
    let cache_dir = manifest_cache_path(app)?;
    let cache = ManifestCache::new(cache_dir);
    let manifest_bytes = if let Some(cached) = cache.load(depot_id, manifest_id) {
        let _ = debug_log::append(app, "steam", "manifest_cache_hit");
        cached
    } else {
        emit_progress(app, "manifest", "downloading manifest", 0, 0, 0.0, 0.0);
        let cdn = CdnClient::new().context("building CDN HTTP client")?;
        let raw = cdn
            .download_manifest_pooled(
                &pool_from(&cdn_servers),
                depot_id,
                manifest_id,
                request_code,
                cdn_auth_token.as_deref(),
            )
            .await
            .context("downloading manifest from CDN")?;
        // Steam wraps the magic-prefixed protobuf blob in a single-entry
        // ZIP. `decompress_manifest` strips that wrapper and returns the
        // bare `<magic><length><proto>×3 + endmagic` bytes — exactly what
        // `ManifestCache::save` wants as its `decompressed` argument.
        let decompressed = decompress_manifest(&raw)
            .context("decompressing manifest body")?;
        let _ = cache.save(depot_id, manifest_id, &decompressed, &raw);
        decompressed
    };

    // 7. Parse the manifest. `steamroom::depot::manifest::DepotManifest::parse`
    //    handles both V4 and V5 on-wire formats (the magic-prefixed
    //    `<payload><metadata><signature><endmagic>` layout we used
    //    to do by hand).
    let mut manifest = DepotManifest::parse(&manifest_bytes)
        .context("parsing manifest protobuf")?;
    if manifest.filenames_encrypted {
        let _ = manifest
            .decrypt_filenames(&depot_key)
            .context("decrypting filenames");
    }

    let total_bytes = manifest
        .total_uncompressed_size
        .unwrap_or_else(|| manifest.files.iter().map(|f| f.size).sum());

    // 8. Hand off to `steamroom-client::download::DepotJob`. It owns
    //    the chunk pipeline: concurrent fetches, CDN pool rotation,
    //    retry-with-backoff, SHA-1 verification, content-addressed
    //    reuse for delta updates, and atomic file writes. We just
    //    forward `DownloadEvent` into our Tauri event names.
    std::fs::create_dir_all(dest_dir)
        .with_context(|| format!("creating {}", dest_dir.display()))?;

    let cdn = CdnClient::new().context("building CDN HTTP client")?;
    let cdn_pool = pool_from(&cdn_servers);
    let fetcher = Arc::new(CdnChunkFetcher::new(cdn, cdn_pool, cdn_auth_token));

    let (event_tx, mut event_rx) = mpsc::unbounded_channel();
    let job = DepotJob::builder()
        .depot_id(depot_id)
        .depot_key(depot_key.clone())
        .install_dir(dest_dir.to_path_buf())
        .verify(true)
        // Non-atomic writes stream chunks straight to the final
        // destination (`file_path`) and skip the
        // `replace_file(staging → final)` step at the end of each
        // file. The atomic path is hitting an intermittent
        // `ERROR_FILE_NOT_FOUND` on Windows during the rename for a
        // handful of large `.pack` files (likely an interaction
        // between Windows file-locking on files already opened by
        // an antivirus / indexer / Steam client and `MoveFileExW`
        // when the source handle is still being closed by the
        // streaming task). The trade-off is that a
        // mid-download interruption leaves the partially written
        // file in place — the next launch's delta-update path
        // will just re-fetch the changed chunks and overwrite.
        .non_atomic(true)
        .event_sender(event_tx)
        .build()
        .context("building depot job")?;

    let total_bytes_for_progress = total_bytes;
    let app_for_progress = app.clone();
    let progress_task = tokio::spawn(async move {
        // Cumulative byte counter passed into the event
        // forwarder so per-chunk `ChunkCompleted` events advance
        // the progress bar smoothly between whole-file
        // `DepotProgress` updates.
        let mut cumulative_bytes: u64 = 0;
        while let Some(ev) = event_rx.recv().await {
            forward_download_event(
                &app_for_progress,
                ev,
                total_bytes_for_progress,
                &mut cumulative_bytes,
            );
        }
    });

    emit_progress(
        app,
        "download",
        "starting download",
        0,
        total_bytes,
        0.0,
        0.0,
    );

    let stats = job
        .download(&manifest, fetcher)
        .await
        .map_err(|e| {
            // Persist the full error chain (including each inner
            // `Io::Os` code/message/path) so a failed file is
            // immediately diagnosable from the debug log instead
            // of having to re-run with a debugger attached.
            let _ = debug_log::append(
                &app,
                "download",
                &format!("depot_download_failed chain={e:#?}"),
            );
            anyhow!("depot download failed: {e:?}")
        })?;

    drop(job);
    let _ = progress_task.await;

    // 9. Save the install under the previous-manifest slot so the
    //    next run can do a delta update instead of a full re-pull.
    let mut depot_config = steamroom_client::depot_config::DepotConfig::load(dest_dir);
    depot_config.set_installed(depot_id, manifest_id, &depot_key);
    let _ = depot_config.save(dest_dir);
    let _ = steamroom_client::depot_config::DepotConfig::save_manifest_decompressed(
        dest_dir,
        depot_id,
        manifest_id,
        &manifest_bytes,
    );

    emit_progress(
        app,
        "download",
        "download complete",
        stats.bytes_downloaded,
        total_bytes,
        0.0,
        0.0,
    );

    let _ = app.emit(
        DEPOT_DONE_EVENT,
        serde_json::json!({
            "finalDir": dest_dir.to_string_lossy(),
            "bytes": stats.bytes_downloaded,
        }),
    );

    // Persist `version.json` so the launcher knows the game is installed
    // and can transition to "Install Patch" / "Play" without requiring
    // the user to re-locate the folder. Without this, every user who
    // completes the depot download is stuck on "Locate PS3 Folder" even
    // though the files are already present on disk.
    if let Err(e) = crate::update::persist_installed_manifest_from_cdn(app, dest_dir).await {
        let _ = debug_log::append(
            app,
            "depot",
            &format!("version.json write failed after depot: {e}"),
        );
    }

    Ok(stats.bytes_downloaded)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Render the Steam-issued QR challenge URL as a PNG data URL the
/// wizard can drop straight into an `<img src>`.
fn render_qr_data_url(challenge_url: &str) -> Result<String> {
    use image::Luma;
    let code = qrcode::QrCode::new(challenge_url.as_bytes())
        .context("encoding QR matrix")?;
    let img: image::GrayImage = code
        .render::<Luma<u8>>()
        .quiet_zone(true)
        .min_dimensions(256, 256)
        .build();
    let mut png = Vec::with_capacity(8 * 1024);
    {
        let mut cursor = std::io::Cursor::new(&mut png);
        img.write_to(&mut cursor, image::ImageFormat::Png)
            .context("encoding QR PNG")?;
    }
    let b64 = base64::engine::general_purpose::STANDARD.encode(png);
    Ok(format!("data:image/png;base64,{b64}"))
}

/// Build a `CdnServerPool` from a fresh `Vec<CdnServer>` (the
/// pool consumes its input). Used by both the manifest fetch and
/// the chunk fetch.
fn pool_from(servers: &[CdnServer]) -> CdnServerPool {
    CdnServerPool::new(servers.to_vec())
}

/// Strip the single-entry ZIP wrapper Steam puts around the
/// `<magic><length><proto>×3 + endmagic` protobuf blob. The first
/// two bytes of a ZIP archive are always `0x50 0x4B` (`PK`); if the
/// CDN body doesn't start with them we pass it through untouched
/// (older manifests occasionally came back raw).
fn decompress_manifest(data: &[u8]) -> Result<Vec<u8>> {
    use std::io::Read;
    if data.len() < 2 || data[0] != 0x50 || data[1] != 0x4B {
        return Ok(data.to_vec());
    }
    let cursor = std::io::Cursor::new(data);
    let mut zip = zip::ZipArchive::new(cursor).context("opening manifest ZIP")?;
    if zip.is_empty() {
        return Err(anyhow!("manifest ZIP has no entries"));
    }
    let mut entry = zip
        .by_index(0)
        .context("reading first manifest ZIP entry")?;
    let mut out = Vec::with_capacity(entry.size() as usize);
    entry
        .read_to_end(&mut out)
        .context("reading manifest ZIP entry contents")?;
    Ok(out)
}

fn manifest_cache_path(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| anyhow!("app_local_data_dir: {e}"))?;
    std::fs::create_dir_all(&dir).ok();
    Ok(dir.join("manifests"))
}

// ---------------------------------------------------------------------------
// Keychain helpers — kept private; the wizard never sees the tokens.
// ---------------------------------------------------------------------------

fn open_keyring(app: &AppHandle) -> Arc<KeyringStore> {
    let plugin = app.keyring();
    Arc::clone(&plugin.store)
}

fn read_refresh_token(app: &AppHandle) -> Result<Option<String>> {
    let store = open_keyring(app);
    match store.get_password(REFRESH_TOKEN_ACCOUNT) {
        Ok(value) => Ok(value),
        Err(err) => {
            let _ = debug_log::append(
                app,
                "steam",
                &format!("keyring read error={err}"),
            );
            Ok(None)
        }
    }
}

fn write_refresh_token(app: &AppHandle, token: &str) -> Result<()> {
    let store = open_keyring(app);
    store
        .set_password(REFRESH_TOKEN_ACCOUNT, token)
        .context("writing refresh token to OS keychain")?;
    Ok(())
}

fn clear_refresh_token(app: &AppHandle) -> Result<()> {
    let store = open_keyring(app);
    let _ = store.delete(REFRESH_TOKEN_ACCOUNT);
    Ok(())
}

fn read_account_name(app: &AppHandle) -> Option<String> {
    let dir = app.path().app_local_data_dir().ok()?;
    let raw = std::fs::read_to_string(dir.join("steam-account.json")).ok()?;
    serde_json::from_str::<serde_json::Value>(&raw)
        .ok()
        .and_then(|v| {
            v.get("accountName")
                .and_then(|n| n.as_str())
                .map(|s| s.to_string())
        })
}

fn write_account_name(app: &AppHandle, account_name: &str) -> Result<()> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| anyhow!("app_local_data_dir: {e}"))?;
    std::fs::create_dir_all(&dir).ok();
    let payload = serde_json::json!({ "accountName": account_name });
    std::fs::write(
        dir.join("steam-account.json"),
        serde_json::to_string_pretty(&payload)?,
    )?;
    Ok(())
}

/// Persist the (refresh_token, account_name) pair returned by the
/// QR flow. Failures are logged but non-fatal — the wizard can
/// still complete if the keychain misbehaves.
fn persist_login(app: &AppHandle, tokens: &steamroom::auth::AuthTokens) {
    if let Err(e) = write_refresh_token(app, &tokens.refresh_token) {
        let _ = debug_log::append(app, "steam", &format!("keyring write failed: {e}"));
    }
    if let Some(account_name) = tokens.account_name.as_deref() {
        if let Err(e) = write_account_name(app, account_name) {
            let _ = debug_log::append(app, "steam", &format!("account name write failed: {e}"));
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri event emitters — one tiny helper per event name keeps the
// payload shape visible at the call site.
// ---------------------------------------------------------------------------

fn emit_progress(
    app: &AppHandle,
    stage: &str,
    message: &str,
    bytes_done: u64,
    bytes_total: u64,
    speed_bps: f64,
    eta_seconds: f64,
) {
    let _ = app.emit(
        DEPOT_PROGRESS_EVENT,
        serde_json::json!({
            "stage": stage,
            "message": message,
            "bytesDone": bytes_done,
            "bytesTotal": bytes_total,
            "speedBps": speed_bps,
            "etaSeconds": eta_seconds,
        }),
    );
}

fn emit_error(app: &AppHandle, message: &str) {
    let _ = app.emit(STEAM_ERROR_EVENT, message);
}

fn emit_depot_error(app: &AppHandle, message: &str) {
    let _ = app.emit(DEPOT_ERROR_EVENT, message);
}

/// Translate `steamroom-client`'s `DownloadEvent` into our Tauri
/// event payload shape. The wizard subscribes to `depot-progress`
/// with `{ stage, message, bytesDone, bytesTotal, speedBps,
/// etaSeconds }`; we forward each event with the stage + message
/// that fits it.
///
/// `steamroom-client`'s `ChunkCompleted` reports a **per-chunk**
/// byte count (each chunk is ~1 MiB of compressed payload), not a
/// cumulative total, and per-file `DepotProgress` is only emitted
/// after an entire file has been written to disk — which means the
/// UI bar would otherwise sit at 0% for several seconds between
/// each file-finished burst, then jump to the next file's full
/// size. We accumulate chunk bytes here so the bar advances
/// smoothly while a file is being downloaded. `DepotProgress`
/// overrides the accumulator with the authoritative
/// `stats.bytes_downloaded` value so the UI can never drift
/// ahead of the actual write.
fn forward_download_event(
    app: &AppHandle,
    ev: DownloadEvent,
    total_bytes: u64,
    cumulative_bytes: &mut u64,
) {
    match ev {
        DownloadEvent::DownloadStarted {
            total_bytes: _,
            total_files,
        } => {
            *cumulative_bytes = 0;
            emit_progress(
                app,
                "download",
                &format!("starting download of {total_files} files"),
                0,
                total_bytes,
                0.0,
                0.0,
            );
        }
        DownloadEvent::FileStarted { filename } => {
            emit_progress(
                app,
                "file",
                &format!("downloading {filename}"),
                *cumulative_bytes,
                total_bytes,
                0.0,
                0.0,
            );
        }
        DownloadEvent::FileCompleted { filename } => {
            // Backstop: if for some reason `DepotProgress`
            // (which carries the authoritative count) never
            // arrived, this still nudges the UI past 0% by the
            // chunk accumulator.
            emit_progress(
                app,
                "file",
                &format!("completed {filename}"),
                *cumulative_bytes,
                total_bytes,
                0.0,
                0.0,
            );
        }
        DownloadEvent::FileSkipped { filename } => {
            emit_progress(
                app,
                "file",
                &format!("skipped {filename}"),
                *cumulative_bytes,
                total_bytes,
                0.0,
                0.0,
            );
        }
        DownloadEvent::FileRemoved { filename } => {
            emit_progress(
                app,
                "file",
                &format!("removed {filename}"),
                *cumulative_bytes,
                total_bytes,
                0.0,
                0.0,
            );
        }
        DownloadEvent::ChunkCompleted { bytes } => {
            // `bytes` is the size of this one chunk, not a
            // cumulative total — sum it ourselves so the bar
            // advances smoothly.
            *cumulative_bytes = cumulative_bytes.saturating_add(bytes);
            emit_progress(
                app,
                "download",
                "downloading",
                *cumulative_bytes,
                total_bytes,
                0.0,
                0.0,
            );
        }
        DownloadEvent::ChunkFailed { error } => {
            // `ErrorChain` flattens the `BoxError` chain into one
            // string. Steam's `Error::CdnStatus` is rendered as
            // `CDN returned HTTP 403`. Detect it specifically so the
            // wizard can show "auth token rejected by CDN" instead
            // of a generic "chunk failed: CDN returned HTTP 403"
            // — the latter is what caused the 403 cascade to look
            // like a transient network blip before.
            let raw = format!("{error}");
            let msg = if raw.contains("HTTP 401") || raw.contains("HTTP 403") {
                format!(
                    "CDN rejected the request ({raw}); \
                     the CDN auth token may be invalid or expired — \
                     try signing out and back in"
                )
            } else {
                format!("chunk failed: {raw}")
            };
            emit_progress(app, "download", &msg, 0, total_bytes, 0.0, 0.0);
        }
        DownloadEvent::DepotProgress {
            completed_bytes,
            total_bytes: evt_total,
        } => {
            let total = if evt_total > 0 { evt_total } else { total_bytes };
            // Authoritative total from `steamroom-client`'s
            // internal stats — overwrite the chunk-accumulator
            // so it can never drift past the real write.
            *cumulative_bytes = completed_bytes;
            emit_progress(
                app,
                "download",
                "downloading",
                completed_bytes,
                total,
                0.0,
                0.0,
            );
        }
        // Forward-compat: future variants fall through silently.
        _ => {}
    }
}
