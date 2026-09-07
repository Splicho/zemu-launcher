use crate::debug_log;
use crate::storage::{ensure_app_data_dir, load_launcher_config};
use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::AppHandle;

/// Default endpoint the launcher calls to fetch a fresh session id.
///
/// The keys service exposes the admin HTML at `/keys`, but the actual
/// JSON API lives at `/authkeys/unclaimed` and returns
/// `{ "keys": [{ "key": "0x...", "status": "fresh", ... }] }`. The
/// launcher picks the first key whose `status` is `"fresh"` and writes
/// its `key` value into `ClientConfig.ini`'s `SessionId=` line.
///
/// Overridable through `LauncherConfig::session_id_endpoint_url` for
/// development / staging environments.
const DEFAULT_SESSION_ID_ENDPOINT: &str = "http://217.160.250.198:8081/authkeys/unclaimed";

/// Default admin key the launcher uses when calling the keys service.
///
/// The keys service doesn't use `Authorization: Bearer …` — it
/// expects the credential in a custom `x-admin-key` request header.
/// This value is the launcher's own server-side credential, not a
/// per-user secret, so baking it in is the same trust model as the
/// endpoint URL above.
///
/// Same override semantics as the URL — config wins.
const DEFAULT_SESSION_ID_BEARER_TOKEN: &str =
    "17c9a537bc592a414b2174bae76d75db9ff001c459d9f274";

/// File name of the cached session id inside `app_data_dir`. Persists
/// across launches so we don't hit the keys endpoint every time the
/// user presses Play.
const SESSION_ID_CACHE_FILE: &str = "session-id-cache.json";

/// File name of the `ClientConfig.ini` the launcher edits on every
/// launch. The H1Z1 client reads this at startup to know which session
/// to attach to.
const CLIENT_CONFIG_FILE: &str = "ClientConfig.ini";

/// Per-process mutex around cache reads/writes so two concurrent
/// `launchGame` invocations (rare, but possible — e.g. the user
/// double-clicks Play while the first one is still mid-fetch) don't
/// race on the cache file. Held only across the fs calls, never
/// across the network round-trip.
static CACHE_LOCK: Mutex<()> = Mutex::new(());

/// On-disk shape of the cache file. `fetched_at` is informational
/// only — the cache is "valid forever" until the user clears it or we
/// decide to rotate it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionIdCache {
    pub session_id: String,
    pub fetched_at: i64,
    /// Endpoint the value was fetched from. Lets us tell the user
    /// "your cached session id came from the staging endpoint, not
    /// prod" if a bug ever surfaces around env mixing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
}

impl SessionIdCache {
    fn now(&mut self) {
        self.fetched_at = chrono::Utc::now().timestamp_millis();
    }
}

/// Resolved endpoint + bearer token. Returned by `resolve_endpoint`
/// so callers can log the actual values they used (and so we can
/// short-circuit network calls when the cache is fresh).
pub struct ResolvedEndpoint {
    pub url: String,
    pub bearer_token: String,
}

/// Resolve the session-id endpoint config: launcher-config override
/// wins, otherwise the baked-in defaults. Empty / whitespace overrides
/// fall back to the default rather than turning into "no endpoint,
/// fail".
pub fn resolve_endpoint(app: &AppHandle) -> ResolvedEndpoint {
    let config = load_launcher_config(app).ok();

    let url = config
        .as_ref()
        .and_then(|c| c.session_id_endpoint_url.as_deref())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or(DEFAULT_SESSION_ID_ENDPOINT)
        .to_string();

    let bearer_token = config
        .as_ref()
        .and_then(|c| c.session_id_bearer_token.as_deref())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or(DEFAULT_SESSION_ID_BEARER_TOKEN)
        .to_string();

    ResolvedEndpoint { url, bearer_token }
}

fn cache_path(app: &AppHandle) -> Result<PathBuf> {
    Ok(ensure_app_data_dir(app)?.join(SESSION_ID_CACHE_FILE))
}

/// Read the cached session id, if any. Returns `Ok(None)` when the
/// file is missing or unparseable — the caller is expected to fall
/// back to a fresh fetch in that case.
pub fn load_cached_session_id(app: &AppHandle) -> Result<Option<SessionIdCache>> {
    let _guard = CACHE_LOCK.lock().ok();
    let path = cache_path(app)?;
    if !path.exists() {
        return Ok(None);
    }

    match fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<SessionIdCache>(&raw).ok())
    {
        Some(cache) if !cache.session_id.is_empty() => Ok(Some(cache)),
        _ => Ok(None),
    }
}

fn save_cached_session_id(app: &AppHandle, cache: &SessionIdCache) -> Result<()> {
    let _guard = CACHE_LOCK.lock().ok();
    let path = cache_path(app)?;
    let raw = serde_json::to_string_pretty(cache).context("serialize session id cache")?;
    // Atomic-ish write: write to a sibling tmp file then rename. Avoids
    // a half-written cache if the process dies mid-write.
    let tmp = path.with_extension("json.tmp");
    {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&tmp)
            .with_context(|| format!("failed opening tmp cache file {}", tmp.display()))?;
        file.write_all(raw.as_bytes())
            .with_context(|| format!("failed writing tmp cache file {}", tmp.display()))?;
        file.sync_all().ok();
    }
    fs::rename(&tmp, &path)
        .with_context(|| format!("failed renaming {} -> {}", tmp.display(), path.display()))?;
    Ok(())
}

/// Drop the cache file. Used by `session_id_clear_cache` and on any
/// error path where the cached value is suspect.
pub fn clear_cached_session_id(app: &AppHandle) -> Result<()> {
    let _guard = CACHE_LOCK.lock().ok();
    let path = cache_path(app)?;
    if path.exists() {
        fs::remove_file(&path)
            .with_context(|| format!("failed removing cache file {}", path.display()))?;
    }
    Ok(())
}

/// Call the keys endpoint and pull out a session id.
///
/// Response format is not formally documented, so we accept a few
/// common shapes:
///
///   * `{ "sessionId": "..." }`  (canonical)
///   * `{ "session_id": "..." }`
///   * `{ "id": "..." }`
///   * `{ "key": "..." }`
///   * `{ "data": { "sessionId": "..." } }`
///   * a bare JSON string `"..."`
///
/// We try the most-specific keys first and fall through to the more
/// generic ones. If nothing matches, the entire body is returned in
/// the error so the dev console + debug log make the mismatch obvious.
pub async fn fetch_session_id_from_api(app: &AppHandle) -> Result<String> {
    let endpoint = resolve_endpoint(app);

    let _ = debug_log::append(
        app,
        "session_id",
        &format!(
            "fetch_session_id_from_api endpoint={}",
            endpoint.url
        ),
    );

    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| anyhow!("failed to build session-id HTTP client: {e}"))?
        .get(&endpoint.url)
        .header("Accept", "application/json")
        // The keys service authenticates via the `x-admin-key` custom
        // header rather than `Authorization: Bearer …`. Sending Bearer
        // here actually *does* work against the admin HTML endpoint
        // (which ignores auth and serves the page) but fails to auth
        // against the JSON API, which is what we want.
        .header("x-admin-key", &endpoint.bearer_token)
        .send()
        .await
        .map_err(|e| anyhow!("session-id request failed: {e}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| anyhow!("session-id response body read failed: {e}"))?;

    let _ = debug_log::append(
        app,
        "session_id",
        &format!("fetch_session_id_from_api status={} body_len={}", status, body.len()),
    );

    if !status.is_success() {
        let _ = debug_log::append(
            app,
            "session_id",
            &format!(
                "fetch_session_id_from_api non_success_body={}",
                truncate(&body, 400)
            ),
        );
        return Err(anyhow!("session-id endpoint returned {status}"));
    }

    let trimmed = body.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("session-id endpoint returned an empty body"));
    }

    let id = parse_session_id_from_body(&body).ok_or_else(|| {
        let _ = debug_log::append(
            app,
            "session_id",
            &format!(
                "fetch_session_id_from_api parse_failed body={}",
                truncate(&body, 400)
            ),
        );
        anyhow!(
            "session-id endpoint returned an unrecognized payload (no sessionId/id/key fields)"
        )
    })?;

    if id.is_empty() {
        return Err(anyhow!("session-id endpoint returned an empty sessionId"));
    }

    Ok(id)
}

fn parse_session_id_from_body(body: &str) -> Option<String> {
    let trimmed = body.trim();

    // Bare JSON string: "abc123".
    if trimmed.starts_with('"') && trimmed.ends_with('"') {
        if let Ok(s) = serde_json::from_str::<String>(trimmed) {
            if !s.is_empty() {
                return Some(s);
            }
        }
    }

    let value: serde_json::Value = serde_json::from_str(trimmed).ok()?;

    // Canonical keys service shape: { "keys": [ { "key": "0x...",
    // "status": "fresh", ... } ] }. We grab the first key whose status
    // is "fresh" so we don't hand the game a key that another launcher
    // instance already grabbed. Falls back to the first key in the
    // array if nothing is explicitly marked fresh.
    if let Some(keys) = value.get("keys").and_then(|v| v.as_array()) {
        if let Some(picked) = keys
            .iter()
            .find(|k| {
                k.get("status")
                    .and_then(|s| s.as_str())
                    .map(|s| s.eq_ignore_ascii_case("fresh"))
                    .unwrap_or(false)
            })
            .or_else(|| keys.first())
            .and_then(|k| k.get("key"))
            .and_then(|v| v.as_str())
        {
            if !picked.is_empty() {
                return Some(picked.to_string());
            }
        }
    }

    // Walk in order of specificity.
    const KEYS: &[&str] = &[
        "sessionId",
        "session_id",
        "id",
        "key",
        "value",
        "token",
    ];

    if let Some(obj) = value.as_object() {
        for key in KEYS {
            if let Some(inner) = obj.get(*key).and_then(|v| v.as_str()) {
                if !inner.is_empty() {
                    return Some(inner.to_string());
                }
            }
            // Nested under "data" / "result" / "payload".
            for wrapper in ["data", "result", "payload"] {
                if let Some(inner) = obj
                    .get(wrapper)
                    .and_then(|v| v.as_object())
                    .and_then(|o| o.get(*key))
                    .and_then(|v| v.as_str())
                {
                    if !inner.is_empty() {
                        return Some(inner.to_string());
                    }
                }
            }
        }
    }

    None
}

/// Returns a usable session id, hitting the network only when the
/// cache is empty.
///
/// `force_refresh = true` always hits the API and overwrites the
/// cache (used by the `session_id_refresh` command and on the
/// first launch after a cache clear).
pub async fn get_session_id(app: &AppHandle, force_refresh: bool) -> Result<String> {
    if !force_refresh {
        if let Some(cache) = load_cached_session_id(app)? {
            let _ = debug_log::append(
                app,
                "session_id",
                &format!(
                    "get_session_id cache_hit fetched_at={} endpoint={}",
                    cache.fetched_at,
                    cache.endpoint.as_deref().unwrap_or("<unknown>")
                ),
            );
            return Ok(cache.session_id);
        }
    }

    let endpoint = resolve_endpoint(app);
    let id = fetch_session_id_from_api(app).await?;

    let mut cache = SessionIdCache {
        session_id: id.clone(),
        fetched_at: 0,
        endpoint: Some(endpoint.url),
    };
    cache.now();
    if let Err(error) = save_cached_session_id(app, &cache) {
        // Failing to persist shouldn't block the launch — just log it.
        let _ = debug_log::append(
            app,
            "session_id",
            &format!("get_session_id cache_save_failed error={error}"),
        );
    }

    Ok(id)
}

/// Write the session id into `ClientConfig.ini` inside `game_directory`.
///
/// The file looks like:
///
/// ```text
/// World=None
/// usenewui=1
/// server=eu.zemu.uk
/// SessionId=0
/// CasSessionId=zemu-local-session
/// ```
///
/// Behavior:
///   * If the file exists, replace the `SessionId=...` line in place,
///     preserving every other line, ordering, and line endings.
///   * If the file is missing, create it with the default content from
///     the spec above so a brand-new install (where the client hasn't
///     been launched yet) still gets a usable config.
///   * Match the key case-insensitively (Windows INI convention) but
///     emit it in the original casing when possible.
pub fn write_session_id_to_client_config(
    game_directory: &str,
    session_id: &str,
) -> Result<()> {
    let config_path = PathBuf::from(game_directory).join(CLIENT_CONFIG_FILE);

    let updated = if config_path.exists() {
        let raw = fs::read_to_string(&config_path)
            .with_context(|| format!("failed reading {}", config_path.display()))?;
        replace_session_id_line(&raw, session_id)
    } else {
        // Brand-new install: no `ClientConfig.ini` on disk yet. Drop
        // in the exact header from the spec so the client has a sane
        // starting point.
        build_default_client_config(session_id)
    };

    // Write atomically: tmp file in the same directory, then rename.
    // Same-directory rename is atomic on Windows / macOS / Linux, which
    // avoids a half-written config if the process dies mid-write.
    let tmp = config_path.with_extension("ini.tmp");
    {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&tmp)
            .with_context(|| format!("failed opening tmp config {}", tmp.display()))?;
        file.write_all(updated.as_bytes())
            .with_context(|| format!("failed writing tmp config {}", tmp.display()))?;
        file.sync_all().ok();
    }
    fs::rename(&tmp, &config_path).with_context(|| {
        format!(
            "failed renaming {} -> {}",
            tmp.display(),
            config_path.display()
        )
    })?;

    Ok(())
}

/// Template used when `ClientConfig.ini` doesn't exist yet. Mirrors
/// the header the user pasted in the spec.
fn build_default_client_config(session_id: &str) -> String {
    format!(
        "World=None\nusenewui=1\nserver=eu.zemu.uk\nSessionId={session_id}\nCasSessionId=zemu-local-session\n"
    )
}

/// Walk the file line-by-line and replace the existing `SessionId=`
/// value. If no such line exists, append one at the end so we never
/// silently drop the value on a config that doesn't have the key yet.
fn replace_session_id_line(raw: &str, session_id: &str) -> String {
    let line_ending = detect_line_ending(raw);
    let mut found = false;
    let mut out = String::with_capacity(raw.len() + 64);

    for line in raw.split_inclusive('\n') {
        let (core, trailing_newline) = if let Some(stripped) = line.strip_suffix('\n') {
            (stripped, "\n")
        } else {
            (line, "")
        };
        let (core_without_cr, cr_suffix) = if let Some(stripped) = core.strip_suffix('\r') {
            (stripped, "\r")
        } else {
            (core, "")
        };

        if let Some((key, _)) = core_without_cr.split_once('=') {
            if key.trim().eq_ignore_ascii_case("SessionId") {
                out.push_str("SessionId=");
                out.push_str(session_id);
                out.push_str(cr_suffix);
                out.push_str(trailing_newline);
                found = true;
                continue;
            }
        }

        out.push_str(core_without_cr);
        out.push_str(cr_suffix);
        out.push_str(trailing_newline);
    }

    if !found {
        // No trailing newline yet — file ended without one. Add one
        // before our appended SessionId line so we don't glue it onto
        // the previous line.
        if !out.ends_with('\n') {
            out.push_str(&line_ending);
        }
        out.push_str("SessionId=");
        out.push_str(session_id);
        out.push_str(&line_ending);
    }

    out
}

/// Sniff the dominant line ending in the file so we can emit the same
/// one when we append. Defaults to `\n` for an empty file.
fn detect_line_ending(raw: &str) -> String {
    if raw.contains("\r\n") {
        "\r\n".to_string()
    } else {
        "\n".to_string()
    }
}

fn truncate(input: &str, max: usize) -> String {
    input.chars().take(max).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replace_session_id_in_pasted_header() {
        let raw = "World=None\nusenewui=1\nserver=eu.zemu.uk\nSessionId=0\nCasSessionId=zemu-local-session\n";
        let updated = replace_session_id_line(raw, "abc123");
        assert!(updated.contains("SessionId=abc123"));
        assert!(updated.contains("CasSessionId=zemu-local-session"));
        assert!(updated.contains("server=eu.zemu.uk"));
        // The old SessionId=0 line should be gone.
        assert!(!updated.contains("SessionId=0"));
    }

    #[test]
    fn replace_session_id_preserves_crlf() {
        let raw = "World=None\r\nusenewui=1\r\nSessionId=0\r\nCasSessionId=zemu-local-session\r\n";
        let updated = replace_session_id_line(raw, "abc");
        assert!(updated.contains("SessionId=abc\r\n"));
        // No bare LF where CRLF used to be.
        assert!(!updated.contains("SessionId=abc\n"));
    }

    #[test]
    fn replace_session_id_appends_when_missing() {
        let raw = "World=None\nserver=eu.zemu.uk\n";
        let updated = replace_session_id_line(raw, "abc");
        assert!(updated.contains("SessionId=abc"));
    }

    #[test]
    fn replace_session_id_is_case_insensitive_on_key() {
        let raw = "sessionid=0\n";
        let updated = replace_session_id_line(raw, "abc");
        // We re-emit the key in canonical casing regardless of input.
        assert!(updated.contains("SessionId=abc"));
    }

    #[test]
    fn build_default_client_config_contains_session_id() {
        let cfg = build_default_client_config("xyz");
        assert!(cfg.contains("SessionId=xyz"));
        assert!(cfg.contains("CasSessionId=zemu-local-session"));
    }

    #[test]
    fn parse_session_id_handles_canonical_field() {
        let body = r#"{"sessionId":"abc123"}"#;
        assert_eq!(parse_session_id_from_body(body), Some("abc123".into()));
    }

    #[test]
    fn parse_session_id_handles_bare_string() {
        let body = r#""abc123""#;
        assert_eq!(parse_session_id_from_body(body), Some("abc123".into()));
    }

    #[test]
    fn parse_session_id_handles_nested_data() {
        let body = r#"{"data":{"sessionId":"abc123"}}"#;
        assert_eq!(parse_session_id_from_body(body), Some("abc123".into()));
    }

    #[test]
    fn parse_session_id_falls_back_to_id_field() {
        let body = r#"{"id":"abc123"}"#;
        assert_eq!(parse_session_id_from_body(body), Some("abc123".into()));
    }

    #[test]
    fn parse_session_id_picks_first_fresh_from_keys_array() {
        // Canonical /authkeys/unclaimed response shape.
        let body = r#"{"count":3,"keys":[{"key":"0xaaa","status":"claimed"},{"key":"0xbbb","status":"fresh"},{"key":"0xccc","status":"fresh"}]}"#;
        assert_eq!(parse_session_id_from_body(body), Some("0xbbb".into()));
    }

    #[test]
    fn parse_session_id_picks_first_key_when_no_fresh_marker() {
        // Be tolerant of the server omitting `status` entirely — we
        // still want *some* key rather than failing the whole launch.
        let body = r#"{"keys":[{"key":"0xaaa"},{"key":"0xbbb"}]}"#;
        assert_eq!(parse_session_id_from_body(body), Some("0xaaa".into()));
    }

    #[test]
    fn parse_session_id_returns_none_on_unknown_shape() {
        let body = r#"{"foo":"bar"}"#;
        assert_eq!(parse_session_id_from_body(body), None);
    }
}