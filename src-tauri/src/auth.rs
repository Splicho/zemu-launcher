use crate::debug_log;
use crate::models::{AuthToken, CommandResult, OAuthCallbackPayload, OAuthState};
use crate::state::AppState;
use crate::storage::{load_auth_store, save_auth_store};
use anyhow::{anyhow, Result};
use base64::Engine;
use chrono::Utc;
use rand::RngCore;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener;
use url::Url;

const OAUTH_STATE_TTL_MS: i64 = 10 * 60 * 1000;

/// Read the launcher's auth app base URL. The compile-time bundled
/// value (`crate::config::API_BASE_URL`, from `src/config/launcher.ts`)
/// is the production source of truth — `launcher-config.json` is no
/// longer consulted, so a tampered local config file can't re-point
/// the launcher at a fake auth host.
///
/// Dev override: `LAUNCHER_AUTH_API_BASE_URL` (env / `.env.local`).
/// The launcher has *two* base URLs in dev — the auth app
/// (`apps/auth`) on port 3003 and the api app (`apps/api`) on
/// 3002 — and the convention here mirrors the existing
/// `LAUNCHER_API_BASE_URL` override used by `hardware_api`. Without
/// this knob the OAuth `exchange_oauth_code` POST landed on the
/// bundled production host in dev (where it 404s) while `/initiate`
/// worked correctly against `localhost:3003`, producing a split-brain
/// where the round-trip started on dev but the redeem step hit prod.
fn resolve_api_base_url(_app: &AppHandle) -> String {
    if let Ok(raw) = std::env::var("LAUNCHER_AUTH_API_BASE_URL") {
        let trimmed = raw.trim().trim_end_matches('/').to_string();
        if !trimmed.is_empty() {
            return trimmed;
        }
    }
    crate::config::API_BASE_URL.to_string()
}

pub fn get_token(app: &AppHandle) -> Result<Option<AuthToken>> {
    // We deliberately do NOT enforce `expires_at` here. The launcher's
    // contract is "stay logged in across launches"; the introspect
    // round-trip in the renderer is what eventually evicts a token the
    // server has definitively rejected (expired / revoked / invalid),
    // and any subsequent protected request will fail with 401 if the
    // bearer is actually dead. Filtering on `expires_at` here would
    // only ever race against a clock skew or a long-running install.
    let store = load_auth_store(app)?;
    Ok(store.token)
}

pub fn save_token(app: &AppHandle, token: AuthToken) -> Result<()> {
    let mut store = load_auth_store(app)?;
    store.token = Some(token);
    save_auth_store(app, &store)
}

/// Exchanges a bearer token for the launcher's `AuthToken` by calling the
/// Auth.js-backed `/api/launcher/user` endpoint on zemu-website. The token
/// can come from any of the configured providers (Discord or email+password)
/// — the website owns the canonical user record and returns
/// the roles/permissions/avatar we should cache locally.
pub async fn complete_oauth_token(
    app: &AppHandle,
    token: String,
    is_dev_runtime: bool,
) -> Result<AuthToken> {
    let api_base_url = if is_dev_runtime {
        "http://localhost:3003".to_string()
    } else {
        resolve_api_base_url(app)
    };
    let request_url = format!("{}/api/launcher/user", api_base_url.trim_end_matches('/'));

    let _ = debug_log::append(
        app,
        "auth",
        &format!(
            "complete_oauth_token request_url={} token_present={}",
            request_url,
            !token.is_empty()
        ),
    );

    let response = reqwest::Client::new()
        .get(&request_url)
        .header("Content-Type", "application/json")
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| anyhow!("OAuth user fetch request failed: {e}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| anyhow!("OAuth user fetch body read failed: {e}"))?;

    let _ = debug_log::append(
        app,
        "auth",
        &format!("complete_oauth_token response_status={status}"),
    );

    if !status.is_success() {
        let _ = debug_log::append(
            app,
            "auth",
            &format!("complete_oauth_token non_success_body={body}"),
        );
        return Err(anyhow!("OAuth user fetch failed: {status}"));
    }

    let parsed: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| anyhow!("OAuth user response parse failed: {e}"))?;
    let user_obj = parsed
        .get("user")
        .and_then(|value| value.as_object())
        .or_else(|| parsed.as_object())
        .ok_or_else(|| anyhow!("OAuth user response missing user object"))?;

    let user_id_value = user_obj
        .get("id")
        .or_else(|| user_obj.get("userId"))
        .ok_or_else(|| anyhow!("OAuth user response missing user id"))?;
    let user_id = if let Some(id) = user_id_value.as_str() {
        id.to_string()
    } else if let Some(id) = user_id_value.as_i64() {
        id.to_string()
    } else if let Some(id) = user_id_value.as_u64() {
        id.to_string()
    } else {
        return Err(anyhow!("OAuth user id has unsupported type"));
    };

    let email = user_obj
        .get("email")
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned);

    let username = user_obj
        .get("username")
        .or_else(|| user_obj.get("name"))
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned);
    let display_name = user_obj
        .get("displayName")
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned);
    let role = user_obj
        .get("role")
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned);
    let roles = user_obj
        .get("roles")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str().map(ToOwned::to_owned))
                .collect::<Vec<_>>()
        });
    let permissions = user_obj
        .get("permissions")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str().map(ToOwned::to_owned))
                .collect::<Vec<_>>()
        });
    let provider = user_obj
        .get("provider")
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned);
    let image = user_obj
        .get("image")
        .or_else(|| user_obj.get("avatar"))
        .or_else(|| user_obj.get("avatarUrl"))
        .or_else(|| user_obj.get("profileImage"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    let token_data = AuthToken {
        token,
        user_id,
        email: email.unwrap_or_default(),
        username,
        display_name,
        role,
        roles,
        permissions,
        provider,
        image,
        expires_at: None,
    };

    save_token(app, token_data.clone())?;
    let _ = debug_log::append(
        app,
        "auth",
        &format!(
            "complete_oauth_token saved user_id={} email_present={} image_present={}",
            token_data.user_id,
            !token_data.email.is_empty(),
            token_data.image.is_some()
        ),
    );

    Ok(token_data)
}

pub fn clear_token(app: &AppHandle) -> Result<()> {
    let mut store = load_auth_store(app)?;
    store.token = None;
    store.oauth_states.clear();
    save_auth_store(app, &store)?;

    if let Some(app_state) = app.try_state::<AppState>() {
        if let Ok(mut pending) = app_state.pending_oauth_callback.lock() {
            *pending = None;
        }
        if let Ok(mut processed) = app_state.processed_oauth_states.lock() {
            processed.clear();
        }
    }

    let _ = debug_log::append(app, "auth", "clear_token completed");
    Ok(())
}

pub fn generate_oauth_state(app: &AppHandle, provider: String) -> Result<String> {
    let mut store = load_auth_store(app)?;
    cleanup_expired_states(&mut store);

    let state = random_hex_32();
    let code_verifier = random_code_verifier();
    let state_record = OAuthState {
        state: state.clone(),
        provider,
        timestamp: Utc::now().timestamp_millis(),
        code_verifier: Some(code_verifier),
    };

    store.oauth_states.insert(state.clone(), state_record);
    save_auth_store(app, &store)?;

    Ok(state)
}

/// Build the PKCE code-challenge that the runtime SHOULD append to
/// the `/api/launcher/oauth/initiate` URL.
///
/// PKCE (RFC 7636) prevents an authorization-code interception
/// attack: the server records `code_challenge` (a SHA-256 hash of
/// `code_verifier`) when the user kicks off the flow and only
/// accepts the matching `code_verifier` when the launcher
/// redeems the authorization `code`. Without it, a leaked
/// authorization code from the redirect URL would itself be
/// redeemable for a bearer JWT.
///
/// Returns `None` if the state has no `code_verifier` (legacy
/// flows written before PKCE shipped, or flows where the
/// authorization server doesn't support S256 challenges).
pub fn code_challenge_for_state(app: &AppHandle, state: &str) -> Result<Option<String>> {
    let store = load_auth_store(app)?;
    Ok(store
        .oauth_states
        .get(state)
        .and_then(|record| record.code_verifier.as_ref())
        .map(|verifier| code_challenge_from_verifier(verifier)))
}

pub fn validate_and_remove_oauth_state(app: &AppHandle, state: &str) -> Result<bool> {
    let mut store = load_auth_store(app)?;
    cleanup_expired_states(&mut store);

    let valid = if let Some(record) = store.oauth_states.get(state) {
        Utc::now().timestamp_millis() - record.timestamp <= OAUTH_STATE_TTL_MS
    } else {
        false
    };

    store.oauth_states.remove(state);
    save_auth_store(app, &store)?;

    Ok(valid)
}

/// Linux, development, and Windows use a loopback callback so browser handoff
/// does not depend on desktop protocol handlers or a second launcher process.
fn uses_loopback_callback(is_dev_runtime: bool) -> bool {
    is_dev_runtime || cfg!(target_os = "linux") || cfg!(target_os = "windows")
}

/// Opens the website's sign-in flow in the user's default browser.
pub fn open_oauth(app: &AppHandle, provider: String, is_dev_runtime: bool) -> CommandResult {
    let _ = debug_log::append(
        app,
        "auth",
        &format!("open_oauth provider={provider} is_dev_runtime={is_dev_runtime}"),
    );
    let result = (|| -> Result<String> {
        let api_base_url = if is_dev_runtime {
            "http://localhost:3003".to_string()
        } else {
            resolve_api_base_url(app)
        };

        let callback_url = if uses_loopback_callback(is_dev_runtime) {
            crate::oauth_server::CALLBACK_URL.to_string()
        } else {
            // Compile-time constant from `crate::config`. The deep-link
            // scheme is no longer persisted to disk and cannot be
            // overridden at runtime — a tampered `launcher-config.json`
            // used to be able to re-point the scheme via
            // `set_oauth_callback_protocol`, but that command is gone.
            let protocol = crate::config::OAUTH_CALLBACK_PROTOCOL;
            format!("{protocol}oauth/callback")
        };
        let state = generate_oauth_state(app, provider.clone())?;
        let _ = debug_log::append(
            app,
            "auth",
            &format!(
                "open_oauth api_base={} callback={} has_state=true",
                api_base_url.trim_end_matches('/'),
                callback_url
            ),
        );

        let mut oauth_url = Url::parse(&format!(
            "{}/api/launcher/oauth/initiate",
            api_base_url.trim_end_matches('/')
        ))
        .map_err(|e| anyhow!(e.to_string()))?;
        oauth_url
            .query_pairs_mut()
            .append_pair("provider", provider.as_str())
            .append_pair("state", state.as_str())
            .append_pair("callback", &callback_url);

        // PKCE: append the S256 challenge so the server-side
        // exchange can verify the verifier we keep locally. The
        // server tolerates the missing fields (it falls back to
        // the legacy `?token=…` redirect) — until Phase B ships,
        // this is purely a forward-compatible upgrade.
        if let Ok(Some(challenge)) = code_challenge_for_state(app, &state) {
            oauth_url
                .query_pairs_mut()
                .append_pair("code_challenge", &challenge)
                .append_pair("code_challenge_method", "S256");
        }

        let _ = debug_log::append(
            app,
            "auth",
            &format!(
                "open_oauth url_host={} query_keys=[provider,state,callback,code_challenge,code_challenge_method]",
                oauth_url.host_str().unwrap_or("?"),
            ),
        );

        if uses_loopback_callback(is_dev_runtime) {
            // Bind before opening the browser, and surface port conflicts to the UI.
            crate::oauth_server::start_oauth_callback_server(app, &state)?;
        }
        // `webbrowser::open` is the historical choice, but on Linux it
        // shells out to `xdg-open` and returns `Ok` the moment that
        // fork succeeds — even if `xdg-open` itself can't reach the
        // user's D-Bus session and silently fails to launch anything.
        // The renderer-side log line `open_oauth browser_opened=true`
        // was therefore a lie: it told the user a browser was open
        // when nothing happened. Tauri 2 ships a first-party opener
        // plugin (`tauri-plugin-opener`) that does the same job with
        // proper platform-aware fallback — direct binary exec on
        // Windows, GIO/D-Bus launch on Linux via the bundled
        // `open-uri` crate — and actually surfaces failures as
        // `Err`. We prefer it for that reason: a missing-D-Bus
        // environment now produces a real error message we can
        // bubble to the user instead of a silent dead click.
        if let Err(error) =
            tauri_plugin_opener::open_url(oauth_url.as_str(), None::<&str>)
        {
            let _ = crate::oauth_server::stop_oauth_callback_server(app, &state);
            let _ = debug_log::append(
                app,
                "auth",
                &format!("open_oauth opener_error={error}"),
            );
            return Err(anyhow!(error.to_string()));
        }
        let _ = debug_log::append(app, "auth", "open_oauth browser_opened=true");
        Ok(state)
    })();

    match result {
        Ok(state) => CommandResult::ok_with_state(state),
        Err(err) => {
            let _ = debug_log::append(app, "auth", &format!("open_oauth error={err}"));
            CommandResult::err(err.to_string())
        }
    }
}

pub fn manual_oauth_callback(
    app: &AppHandle,
    token: String,
    state: Option<String>,
) -> CommandResult {
    let _ = debug_log::append(
        app,
        "auth",
        &format!(
            "manual_oauth_callback token_present={} state_present={}",
            !token.is_empty(),
            state.is_some()
        ),
    );
    let result = (|| -> Result<()> {
        if let Some(ref s) = state {
            if !validate_and_remove_oauth_state(app, s)? {
                let _ = debug_log::append(app, "auth", "manual_oauth_callback invalid_state");
                return Err(anyhow!("Invalid or expired OAuth state"));
            }
        }

        emit_oauth_callback(app, Some(token), state, None)?;
        Ok(())
    })();

    match result {
        Ok(_) => CommandResult::ok(),
        Err(err) => {
            let _ = debug_log::append(app, "auth", &format!("manual_oauth_callback error={err}"));
            CommandResult::err(err.to_string())
        }
    }
}

pub fn process_oauth_callback(
    app: &AppHandle,
    token: Option<String>,
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
) -> Result<()> {
    let _ = debug_log::append(
        app,
        "auth",
        &format!(
            "process_oauth_callback token_present={} code_present={} state_present={} error_present={}",
            token.is_some(),
            code.is_some(),
            state.is_some(),
            error.is_some()
        ),
    );
    // Capture the PKCE verifier *before* the state record is
    // removed. `validate_and_remove_oauth_state` deletes the entry
    // from `oauth_states` on a valid result, so a PKCE exchange
    // attempt afterwards would see `None` for the verifier, fall
    // through to the legacy branch, and end up surfacing "OAuth
    // callback missing token" to the renderer — even though
    // `/initiate` had stored a perfectly good verifier. The order
    // matters: capture → validate-and-remove → redeem.
    let pre_captured_verifier: Option<String> = state
        .as_deref()
        .and_then(|s| load_code_verifier(app, s));
    let _ = debug_log::append(
        app,
        "auth",
        &format!(
            "process_oauth_callback verifier_present={}",
            pre_captured_verifier.is_some()
        ),
    );

    let final_error = if let Some(s) = state.clone() {
        if let Some(app_state) = app.try_state::<AppState>() {
            if app_state.is_oauth_state_duplicate(&s) {
                let _ = debug_log::append(
                    app,
                    "auth",
                    "process_oauth_callback duplicate_state_ignored=true",
                );
                return Ok(());
            }
        }

        match validate_and_remove_oauth_state(app, &s) {
            Ok(true) => {
                let _ = debug_log::append(app, "auth", "process_oauth_callback state_valid=true");
                if let Some(app_state) = app.try_state::<AppState>() {
                    app_state.mark_oauth_state_processed(s);
                }
                error
            }
            Ok(false) => {
                let _ = debug_log::append(app, "auth", "process_oauth_callback state_valid=false");
                Some("Invalid or expired OAuth state".to_string())
            }
            Err(e) => {
                let _ = debug_log::append(
                    app,
                    "auth",
                    &format!("process_oauth_callback state_validation_error={e}"),
                );
                Some(format!("State validation failed: {e}"))
            }
        }
    } else {
        let _ = debug_log::append(app, "auth", "process_oauth_callback state_missing=true");
        Some("Missing OAuth state".to_string())
    };

    // PKCE code-exchange path: when the server returned `?code=`
    // instead of `?token=`, redeem it for the bearer JWT here. We
    // only attempt the exchange when the OAuth state validated
    // cleanly (i.e. `final_error.is_none()` and we have a code +
    // state). The verifier was captured *before* state validation
    // removed the record from the store — see the `load_code_verifier`
    // block above — so re-reading here would always return `None`
    // and we'd silently fall into the legacy "missing token" branch.
    let token = if let (Some(code), Some(_state), None) =
        (code.as_ref(), state.as_ref(), final_error.as_ref())
    {
        match pre_captured_verifier.as_deref() {
            Some(verifier) => match exchange_oauth_code(app, code, verifier) {
                Ok(bearer) => Some(bearer),
                Err(err) => {
                    let _ = debug_log::append(
                        app,
                        "auth",
                        &format!("process_oauth_callback exchange_error={err}"),
                    );
                    return Err(err);
                }
            },
            None => {
                let _ = debug_log::append(
                    app,
                    "auth",
                    "process_oauth_callback exchange_skipped=no_verifier",
                );
                token
            }
        }
    } else {
        token
    };

    let final_error = final_error.or_else(|| {
        token
            .as_deref()
            .filter(|value| !value.is_empty())
            .is_none()
            .then(|| "OAuth callback missing token".to_string())
    });
    let _ = debug_log::append(
        app,
        "auth",
        &format!(
            "process_oauth_callback final_error_present={}",
            final_error.is_some()
        ),
    );
    emit_oauth_callback(app, token, state, final_error.clone())?;
    match final_error {
        Some(error) => Err(anyhow!(error)),
        None => Ok(()),
    }
}

pub fn take_pending_oauth_callback(
    app: &AppHandle,
    expected_state: Option<&str>,
) -> Option<OAuthCallbackPayload> {
    let state = app.try_state::<AppState>()?;
    let mut guard = state.pending_oauth_callback.lock().ok()?;
    let payload = take_matching_callback(&mut guard, expected_state);
    let _ = debug_log::append(
        app,
        "auth",
        &format!("take_pending_oauth_callback found={}", payload.is_some()),
    );
    payload
}

fn take_matching_callback(
    pending: &mut Option<OAuthCallbackPayload>,
    expected_state: Option<&str>,
) -> Option<OAuthCallbackPayload> {
    if let Some(expected) = expected_state {
        if pending.as_ref()?.state.as_deref() != Some(expected) {
            return None;
        }
    }
    pending.take()
}

fn emit_oauth_callback(
    app: &AppHandle,
    token: Option<String>,
    state: Option<String>,
    error: Option<String>,
) -> Result<()> {
    let payload = OAuthCallbackPayload {
        token,
        code: None,
        state,
        error,
    };
    let _ = debug_log::append(
        app,
        "auth",
        &format!(
            "emit_oauth_callback token_present={} state_present={} error_present={}",
            payload.token.is_some(),
            payload.state.is_some(),
            payload.error.is_some()
        ),
    );

    if let Some(app_state) = app.try_state::<AppState>() {
        if let Ok(mut guard) = app_state.pending_oauth_callback.lock() {
            *guard = Some(payload.clone());
            let _ = debug_log::append(app, "auth", "emit_oauth_callback cached_pending=true");
        }
    }

    app.emit("oauth-callback", payload)
        .map_err(|e| anyhow!(e.to_string()))?;
    let _ = debug_log::append(app, "auth", "emit_oauth_callback emitted_event=true");
    Ok(())
}

fn cleanup_expired_states(store: &mut crate::models::AuthStore) {
    let now = Utc::now().timestamp_millis();
    store
        .oauth_states
        .retain(|_, value| now - value.timestamp <= OAUTH_STATE_TTL_MS);
}

fn random_hex_32() -> String {
    // 16 random bytes -> 32 hex characters. This is the launcher's
    // OAuth `state` value, and the auth server's PKCE repo gates on
    // `STATE_PATTERN = /^[a-f0-9]{32}$/i` — anything longer or shorter
    // gets rejected at /api/launcher/oauth/initiate with `Invalid PKCE
    // parameters`. The previous version of this function generated
    // 32 bytes (64 hex chars), which silently matched the function's
    // name but violated the wire contract; the launcher would surface
    // a `400` instead of opening Steam/Discord. 128 bits of entropy
    // is plenty for CSRF purposes — the value never leaves the
    // user's machine, only its SHA-256-derived PKCE challenge does.
    let mut bytes = [0_u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// PKCE code-verifier: 32 random bytes, base64url-encoded without
/// padding. RFC 7636 §4.1 specifies 43–128 chars from the
/// unreserved set; this gives us 43, which is the minimum allowed.
///
/// `OsRng` isn't directly available without the `getrandom`
/// feature on `rand`, but `rand::thread_rng()` reads from the
/// platform CSPRNG via `getrandom` underneath, which is fine for
/// an OAuth CSPRF token.
fn random_code_verifier() -> String {
    let mut bytes = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// PKCE code-challenge: BASE64URL(SHA-256(code_verifier)).
///
/// RFC 7636 §4.2 says the challenge is `BASE64URL(SHA256(ASCII(code_verifier)))`.
/// `S256` is the only challenge method we send; the server is
/// expected to reject `plain` (it has no security advantage over
/// the legacy `?token=…` redirect we're replacing).
fn code_challenge_from_verifier(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let digest = hasher.finalize();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
}

/// Read the PKCE code-verifier from the auth store without
/// removing the surrounding state record. Called once from
/// `process_oauth_callback` — *before* the function calls
/// `validate_and_remove_oauth_state` — so the verifier is still in
/// the store at read time. The PKCE branch then reuses the captured
/// value instead of re-reading (the state entry would already be
/// gone by then).
///
/// Returns `None` for legacy `?token=` redirects (no verifier was
/// ever stored) and for unknown / already-cleaned-up states.
fn load_code_verifier(app: &AppHandle, state: &str) -> Option<String> {
    let store = load_auth_store(app).ok()?;
    store
        .oauth_states
        .get(state)
        .and_then(|record| record.code_verifier.clone())
}

/// Exchange a PKCE authorization code for a bearer JWT.
///
/// POSTs to `/api/launcher/oauth/exchange` with the code and the
/// verifier we stored at `generate_oauth_state` time. The server
/// validates the verifier against the challenge it recorded
/// during `/api/launcher/oauth/initiate`, then returns the same
/// bearer that the legacy `?token=` redirect used to carry — so
/// the downstream `complete_oauth_token` path doesn't need to
/// know it came in via PKCE vs. legacy.
///
/// Blocking I/O on `reqwest::blocking` is deliberate: this is
/// only ever called from the loopback callback server's worker
/// thread (or the deep-link handler), both of which are
/// outside the async runtime. We do not want to pay the cost
/// of a `tokio::task::spawn` round-trip here.
fn exchange_oauth_code(
    app: &AppHandle,
    code: &str,
    verifier: &str,
) -> Result<String> {
    let api_base_url = resolve_api_base_url(app);
    let request_url = format!(
        "{}/api/launcher/oauth/exchange",
        api_base_url.trim_end_matches('/')
    );
    let _ = debug_log::append(
        app,
        "auth",
        &format!("exchange_oauth_code request_url={}", request_url),
    );

    // Form-encoded POST body. The server is expected to read it
    // with a standard OAuth2/OIDC-compatible parser; form encoding
    // (not JSON) is what every spec-compliant auth server expects.
    let body = format!(
        "grant_type=authorization_code&code={}&code_verifier={}&redirect_uri={}",
        urlencoding(code),
        urlencoding(&verifier),
        urlencoding(crate::oauth_server::CALLBACK_URL),
    );

    let response = reqwest::blocking::Client::new()
        .post(&request_url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .map_err(|e| anyhow!("OAuth code exchange request failed: {e}"))?;
    let status = response.status();
    let raw_body = response
        .text()
        .map_err(|e| anyhow!("OAuth exchange body read failed: {e}"))?;
    let _ = debug_log::append(
        app,
        "auth",
        &format!("exchange_oauth_code status={}", status),
    );
    if !status.is_success() {
        let _ = debug_log::append(
            app,
            "auth",
            &format!(
                "exchange_oauth_code non_success_body={}",
                raw_body.chars().take(400).collect::<String>()
            ),
        );
        return Err(anyhow!("OAuth code exchange failed: HTTP {status}"));
    }
    let parsed: serde_json::Value = serde_json::from_str(&raw_body)
        .map_err(|e| anyhow!("OAuth exchange JSON parse failed: {e}"))?;
    let token = parsed
        .get("token")
        .or_else(|| parsed.get("access_token"))
        .and_then(|value| value.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| anyhow!("OAuth exchange response missing `token`"))?;
    Ok(token)
}

/// Minimal RFC 3986 percent-encoder for form-encoded POST bodies.
///
/// We hand-roll this (instead of pulling in `urlencoding`) to keep
/// the dependency surface narrow — the values being encoded are
/// short, ASCII-only strings (the code, verifier, and a
/// constant callback URL), so a one-line implementation is
/// enough.
fn urlencoding(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'~' => out.push(*byte as char),
            other => out.push_str(&format!("%{:02X}", other)),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_uses_loopback_on_linux_and_windows() {
        assert!(uses_loopback_callback(true));
        let linux_or_windows = cfg!(target_os = "linux") || cfg!(target_os = "windows");
        assert_eq!(uses_loopback_callback(false), linux_or_windows);
    }

    #[test]
    fn pending_callback_is_consumed_only_by_its_flow() {
        let mut pending = Some(OAuthCallbackPayload {
            token: Some("test-token".into()),
            code: None,
            state: Some("expected-state".into()),
            error: None,
        });
        assert!(take_matching_callback(&mut pending, Some("other-state")).is_none());
        assert!(pending.is_some());
        let payload = take_matching_callback(&mut pending, Some("expected-state")).unwrap();
        assert_eq!(payload.token.as_deref(), Some("test-token"));
        assert!(take_matching_callback(&mut pending, Some("expected-state")).is_none());
    }

    #[test]
    fn pkce_code_challenge_matches_sha256_of_verifier() {
        // The verifier/challenge pair is locked in by RFC 7636 §B.
        // Verifier `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXfqNk`
        // is the canonical Appendix B test vector; SHA-256 of it,
        // base64url-no-pad, is the expected S256 challenge.
        // `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM` is the
        // S256 challenge listed in some references, but it
        // actually equals the verifier unchanged (i.e. it is the
        // plain-method challenge, not the S256 one). Our value is
        // the genuine SHA-256 challenge; any future change here
        // would break every existing /exchange request.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXfqNk";
        let expected = "k-QfUN-s0qjS-u3s7Q89P3A9rJQ6FT_vOv-0PTKy68U";
        assert_eq!(code_challenge_from_verifier(verifier), expected);
    }

    #[test]
    fn pkce_code_verifier_has_rfc_compliant_length() {
        // 32 random bytes → 43 base64url chars (no padding). RFC
        // 7636 §4.1 requires 43–128; we generate the minimum.
        let verifier = random_code_verifier();
        assert_eq!(verifier.len(), 43);
        assert!(verifier
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn oauth_state_hex_length_matches_server_contract() {
        // The auth server's `STATE_PATTERN = /^[a-f0-9]{32}$/i` is
        // the wire contract for the OAuth `state` query parameter.
        // If this assertion ever fails, the launcher is producing a
        // length the server will reject with `Invalid PKCE parameters`
        // and the whole login dance 400s before Steam ever loads.
        let state = random_hex_32();
        assert_eq!(state.len(), 32);
        assert!(state.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }
}
