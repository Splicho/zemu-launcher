use crate::debug_log;
use crate::models::{AuthToken, CommandResult, OAuthCallbackPayload, OAuthState};
use crate::state::AppState;
use crate::storage::{
    detect_api_base_url, detect_oauth_callback_protocol, load_auth_store, save_auth_store,
};
use anyhow::{anyhow, Result};
use chrono::Utc;
use rand::RngCore;
use tauri::{AppHandle, Emitter, Manager};
use url::Url;

const API_BASE_URL_FALLBACK: &str = "https://id.zemu.uk";
const OAUTH_STATE_TTL_MS: i64 = 10 * 60 * 1000;

fn resolve_api_base_url(app: &AppHandle) -> String {
    detect_api_base_url(app)
        .ok()
        .flatten()
        .filter(|url| !url.trim().is_empty())
        .unwrap_or_else(|| API_BASE_URL_FALLBACK.to_string())
}

pub fn get_token(app: &AppHandle) -> Result<Option<AuthToken>> {
    let mut store = load_auth_store(app)?;

    let token = match store.token.clone() {
        Some(token) => token,
        None => return Ok(None),
    };

    if let Some(expires_at) = token.expires_at {
        if expires_at < Utc::now().timestamp_millis() {
            store.token = None;
            save_auth_store(app, &store)?;
            return Ok(None);
        }
    }

    Ok(Some(token))
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
    let state_record = OAuthState {
        state: state.clone(),
        provider,
        timestamp: Utc::now().timestamp_millis(),
    };

    store.oauth_states.insert(state.clone(), state_record);
    save_auth_store(app, &store)?;

    Ok(state)
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

/// Opens the user's browser to the OAuth provider's sign-in page. The
/// provider name maps to one of the two configured on zemu-website
/// (`discord`, `credentials`). For `credentials` we open a hosted
/// sign-in page that posts the resulting bearer token back via the
/// registered deep-link protocol.
pub fn open_oauth(app: &AppHandle, provider: String, is_dev_runtime: bool) -> CommandResult {
    let _ = debug_log::append(
        app,
        "auth",
        &format!("open_oauth provider={provider} is_dev_runtime={is_dev_runtime}"),
    );
    let result = (|| -> Result<String> {
        let state = generate_oauth_state(app, provider.clone())?;

        let api_base_url = if is_dev_runtime {
            "http://localhost:3003".to_string()
        } else {
            resolve_api_base_url(app)
        };

        let callback_url = if is_dev_runtime {
            "http://localhost:31337/oauth/callback".to_string()
        } else {
            let protocol = detect_oauth_callback_protocol(app)?
                .ok_or_else(|| anyhow!("OAuth callback protocol is not configured"))?;
            format!("{protocol}oauth/callback")
        };
        let _ = debug_log::append(
            app,
            "auth",
            &format!(
                "open_oauth api_base={} callback={}",
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
        let _ = debug_log::append(app, "auth", &format!("open_oauth url={oauth_url}"));

        webbrowser::open(oauth_url.as_str()).map_err(|e| anyhow!(e.to_string()))?;
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
    state: Option<String>,
    error: Option<String>,
) {
    let _ = debug_log::append(
        app,
        "auth",
        &format!(
            "process_oauth_callback token_present={} state_present={} error_present={}",
            token.is_some(),
            state.is_some(),
            error.is_some()
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
                return;
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
        error
    };

    let _ = debug_log::append(
        app,
        "auth",
        &format!(
            "process_oauth_callback final_error_present={}",
            final_error.is_some()
        ),
    );
    let _ = emit_oauth_callback(app, token, state, final_error);
}

pub fn take_pending_oauth_callback(app: &AppHandle) -> Option<OAuthCallbackPayload> {
    let state = app.try_state::<AppState>()?;
    let mut guard = state.pending_oauth_callback.lock().ok()?;
    let payload = guard.take();
    let _ = debug_log::append(
        app,
        "auth",
        &format!("take_pending_oauth_callback found={}", payload.is_some()),
    );
    payload
}

fn emit_oauth_callback(
    app: &AppHandle,
    token: Option<String>,
    state: Option<String>,
    error: Option<String>,
) -> Result<()> {
    let payload = OAuthCallbackPayload {
        token,
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
    let mut bytes = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}
