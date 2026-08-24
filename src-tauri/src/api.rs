use crate::auth;
use crate::debug_log;
use crate::storage::detect_api_base_url;
use anyhow::{anyhow, Result};
use tauri::AppHandle;
use url::Url;

const API_BASE_URL_FALLBACK: &str = "https://auth.zemu.uk";

fn resolve_api_base_url(app: &AppHandle) -> String {
    detect_api_base_url(app)
        .ok()
        .flatten()
        .filter(|url| !url.trim().is_empty())
        .unwrap_or_else(|| API_BASE_URL_FALLBACK.to_string())
}

/// Generic bearer-auth passthrough for the launcher's API surface. Each
/// route is proxied through the launcher's auth state so the front-end
/// never sees the bearer token directly.
pub async fn api_get(
    app: &AppHandle,
    path: &str,
    query: Option<Vec<(String, String)>>,
) -> Result<serde_json::Value> {
    let token = auth::get_token(app)
        .map_err(|e| anyhow!("Launcher token lookup failed: {e}"))?
        .ok_or_else(|| anyhow!("Launcher authentication token is missing"))?;

    let api_base_url = resolve_api_base_url(app);
    let base = api_base_url.trim_end_matches('/');
    let trimmed_path = path.trim_start_matches('/');
    let mut request_url = Url::parse(&format!("{base}/{trimmed_path}"))?;
    if let Some(pairs) = query {
        let mut query_pairs = request_url.query_pairs_mut();
        for (key, value) in pairs {
            query_pairs.append_pair(&key, &value);
        }
    }

    let _ = debug_log::append(
        app,
        "api.get",
        &format!("api_get request_url={}", request_url),
    );

    let response = reqwest::Client::new()
        .get(request_url.clone())
        .header("Content-Type", "application/json")
        .bearer_auth(&token.token)
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
        "api.get",
        &format!("api_get status={} path={}", status, trimmed_path),
    );

    if !status.is_success() {
        let _ = debug_log::append(
            app,
            "api.get",
            &format!("api_get non_success_body={}", truncate(&body)),
        );
        return Err(anyhow!("API request failed: {status}"));
    }

    serde_json::from_str(&body).map_err(|e| anyhow!("API response parse failed: {e}"))
}

pub async fn api_post(
    app: &AppHandle,
    path: &str,
    payload: serde_json::Value,
) -> Result<serde_json::Value> {
    let token = auth::get_token(app)
        .map_err(|e| anyhow!("Launcher token lookup failed: {e}"))?
        .ok_or_else(|| anyhow!("Launcher authentication token is missing"))?;

    let api_base_url = resolve_api_base_url(app);
    let base = api_base_url.trim_end_matches('/');
    let trimmed_path = path.trim_start_matches('/');
    let request_url = Url::parse(&format!("{base}/{trimmed_path}"))?;

    let _ = debug_log::append(
        app,
        "api.post",
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
        "api.post",
        &format!("api_post status={} path={}", status, trimmed_path),
    );

    if !status.is_success() {
        let _ = debug_log::append(
            app,
            "api.post",
            &format!("api_post non_success_body={}", truncate(&body)),
        );
        return Err(anyhow!("API request failed: {status}"));
    }

    serde_json::from_str(&body).map_err(|e| anyhow!("API response parse failed: {e}"))
}

fn truncate(input: &str) -> String {
    input.chars().take(400).collect()
}
