//! Authenticated POST to the api backend (`api.zemu.uk`).
//!
//! Today the launcher has two distinct base URLs in its
//! `LauncherConfig` (renderer-side `LAUNCHER_CONFIG`) and a single
//! `api_base_url` field on the Rust side that points at the **auth**
//! app (`id.zemu.uk`) — that's where the OAuth flow lives and where
//! the launcher tokens come from. The hardware-enrollment endpoint,
//! however, lives on the **api** (`apps/api`, `api.zemu.uk`) because
//! the api owns the `user_hardware_id` table and is the only place
//! the `LauncherBearerGuard` is configured to accept the JWT.
//!
//! Until the launcher's URL model grows a second config slot, the
//! hardware enrollment hits the api host directly via a hard-coded
//! fallback default (overridable with `LAUNCHER_API_BASE_URL` for
//! dev). The fallback list matches the renderer-side
//! `LAUNCHER_CONFIG.friendsApiBaseUrl` so the dev/prod URLs stay in
//! sync.
//!
//! ## Why not reuse `api::api_post`
//!
//! `api::api_post` resolves the URL via `detect_api_base_url`, which
//! is the auth app. Sending hardware enrollment there would 404 with
//! `Cannot GET /v1/hardware/enroll` because the auth app doesn't
//! mount that route.
//!
//! ## Why not extend `api::api_post`
//!
//! A second base URL could live in the `LauncherConfig` (the renderer
//! already exposes `friendsApiBaseUrl`). Doing it in this PR would
//! touch every existing call site, most of which intentionally hit
//! the auth app — risk of regressing the OAuth introspect/refresh
//! surface. Keeping the base URL local to the hardware module keeps
//! the blast radius to one Tauri command.

use crate::auth;
use crate::debug_log;
use anyhow::{anyhow, Result};
use tauri::AppHandle;
use url::Url;

/// Production default — mirrors the renderer-side
/// `LAUNCHER_CONFIG.friendsApiBaseUrl`. Overridable via env for dev
/// builds (e.g. `LAUNCHER_API_BASE_URL=http://localhost:3002`).
const API_BASE_URL_FALLBACK: &str = "https://api.zemu.uk";

/// Dev override. The launcher's Rust side doesn't read
/// `LAUNCHER_CONFIG.friendsApiBaseUrl` (it's renderer-only), so we
/// mirror that env var through the launcher-side `LAUNCHER_API_BASE_URL`
/// if it's set. In production this stays unset and the prod fallback
/// wins.
fn resolve_api_base_url() -> String {
    if let Ok(raw) = std::env::var("LAUNCHER_API_BASE_URL") {
        let trimmed = raw.trim().trim_end_matches('/').to_string();
        if !trimmed.is_empty() {
            return trimmed;
        }
    }
    API_BASE_URL_FALLBACK.to_string()
}

/// Authenticated POST against the api backend. Sends the launcher
/// JWT as a bearer (the api's `LauncherBearerGuard` verifies it via
/// the shared `LAUNCHER_TOKEN_SECRET` and resolves the user from
/// the JWT's `sub` claim).
pub async fn api_post(
    app: &AppHandle,
    path: &str,
    payload: serde_json::Value,
) -> Result<serde_json::Value> {
    let token = auth::get_token(app)
        .map_err(|e| anyhow!("Launcher token lookup failed: {e}"))?
        .ok_or_else(|| anyhow!("Launcher authentication token is missing"))?;

    let api_base_url = resolve_api_base_url();
    let base = api_base_url.trim_end_matches('/');
    let trimmed_path = path.trim_start_matches('/');
    let request_url = Url::parse(&format!("{base}/{trimmed_path}"))?;

    let _ = debug_log::append(
        app,
        "hardware.api",
        &format!("api_post request_url={}", request_url),
    );

    let response = reqwest::Client::new()
        .post(request_url.clone())
        .header("Content-Type", "application/json")
        .bearer_auth(&token.token)
        .json(&payload)
        .send()
        .await
        .map_err(|e| anyhow!("API request failed: {e}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| anyhow!("API response body read failed: {e}"))?;

    let _ = debug_log::append(
        app,
        "hardware.api",
        &format!("api_post status={} path={}", status, trimmed_path),
    );

    if !status.is_success() {
        let _ = debug_log::append(
            app,
            "hardware.api",
            &format!("api_post non_success_body={}", truncate(&body)),
        );
        return Err(anyhow!("API request failed: {status}"));
    }

    serde_json::from_str(&body).map_err(|e| anyhow!("API response parse failed: {e}"))
}

fn truncate(input: &str) -> String {
    input.chars().take(400).collect()
}

/// Synchronous-friendly wrapper around `api_post` that accepts a
/// pre-serialised JSON byte slice instead of a `serde_json::Value`.
///
/// Useful when the caller already paid for serialisation (e.g. the
/// process-integrity monitor serialises once per scan and passes the
/// bytes through) or when a tighter error type than
/// `anyhow::Result` is desired. Errors are surfaced as
/// [`ApiPostError`] so callers can `.unwrap_or_log` or fall back
/// without unwrapping an `anyhow::Error`.
#[derive(Debug)]
pub enum ApiPostError {
    /// No launcher JWT stored locally — the user hasn't signed in.
    NoToken,
    /// Network / request build failure.
    Request(String),
    /// Server returned a non-2xx status. Carries the status + a
    /// truncated body so the caller can log it without dumping
    /// potentially-large error blobs.
    BadStatus { status: u16, body: String },
    /// Response body didn't parse as JSON. Future use — the
    /// integrity monitor doesn't currently need JSON back from the
    /// api, but having the variant in the public type lets future
    /// callers use the same helper.
    #[allow(dead_code)]
    BadBody(String),
    /// Misc. serialisation failures (rare — body is pre-serialised).
    #[allow(dead_code)]
    Other(String),
}

impl std::fmt::Display for ApiPostError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ApiPostError::NoToken => write!(f, "launcher token missing"),
            ApiPostError::Request(msg) => write!(f, "request failed: {msg}"),
            ApiPostError::BadStatus { status, body } => {
                write!(f, "status {status}: {}", truncate(body))
            }
            ApiPostError::BadBody(msg) => write!(f, "bad body: {msg}"),
            ApiPostError::Other(msg) => write!(f, "{msg}"),
        }
    }
}

impl std::error::Error for ApiPostError {}

/// Like [`api_post`] but takes a pre-serialised JSON body. Used by
/// the process-integrity monitor, which serialises its event once
/// per scan rather than carrying a `serde_json::Value` through every
/// iteration of its inner loop.
///
/// Returns `Ok(())` on a 2xx response — the api's
/// `POST /v1/moderation/integrity/events` doesn't return any data
/// the launcher needs; it only needs to know "did the server accept
/// the report".
pub fn api_post_json(
    app: &AppHandle,
    path: &str,
    body: &[u8],
) -> Result<(), ApiPostError> {
    let token = auth::get_token(app)
        .map_err(|e| ApiPostError::Other(format!("token lookup: {e}")))?
        .ok_or(ApiPostError::NoToken)?;

    let api_base_url = resolve_api_base_url();
    let base = api_base_url.trim_end_matches('/');
    let trimmed_path = path.trim_start_matches('/');
    let request_url = Url::parse(&format!("{base}/{trimmed_path}"))
        .map_err(|e| ApiPostError::Other(format!("url parse: {e}")))?;

    let _ = debug_log::append(
        app,
        "integrity.api",
        &format!("api_post_json path={} body_bytes={}", trimmed_path, body.len()),
    );

    // We deliberately use a synchronous `reqwest::blocking::Client`
    // here — `api_post_json` is called from the integrity monitor's
    // thread (a plain `std::thread`, not a tokio task), and we don't
    // want to introduce a tokio runtime just for one POST. The
    // request is tiny and the monitor tolerates a multi-second
    // blocking call (it sleeps the full poll interval afterwards).
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| ApiPostError::Request(format!("client build: {e}")))?;
    let response = client
        .post(request_url.clone())
        .header("Content-Type", "application/json")
        .bearer_auth(&token.token)
        .body(body.to_vec())
        .send()
        .map_err(|e| ApiPostError::Request(e.to_string()))?;

    let status = response.status();
    if !status.is_success() {
        let body_text = response.text().unwrap_or_default();
        let _ = debug_log::append(
            app,
            "integrity.api",
            &format!(
                "api_post_json status={} body={}",
                status,
                truncate(&body_text)
            ),
        );
        return Err(ApiPostError::BadStatus {
            status: status.as_u16(),
            body: body_text,
        });
    }

    Ok(())
}
