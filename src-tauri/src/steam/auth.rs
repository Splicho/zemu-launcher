//! Steam authentication using `steamroom-client`.
//!
//! Two entry points:
//!   * [`login_with_refresh_token`] — silent re-auth using a stored token
//!   * [`login_with_credentials`] — first-time login (prompts for password
//!     and, if Steam asks, a Steam Guard code)
//!
//! Both return a `LoggedIn` client ready for `get_depot_decryption_key`,
//! `get_cdn_servers`, etc.

use crate::debug_log;
use crate::models::{SteamCredentials, SteamLoginResult};
use anyhow::{anyhow, Result};
use chrono::Utc;
use steamroom::auth::GuardType;
use steamroom::client::LoggedIn;
use steamroom::client::SteamClient;
use steamroom_client::login::ConfirmationChallenge;
use steamroom_client::login::CredentialsLoginFlow;
use steamroom_client::login::LoginBuilder;
use steamroom_client::login::LoginError;
use tauri::{AppHandle, Emitter};

/// Event the renderer listens to so it can show an "Awaiting Steam
/// authenticator approval…" indicator while the backend blocks on
/// `ConfirmationChallenge::wait_for_confirmation`.
pub const STEAM_MOBILE_CONFIRMATION_PENDING_EVENT: &str = "steam-mobile-confirmation-pending";

const DEVICE_NAME: &str = "Zemu Launcher";

/// Authenticate using a stored refresh token. Returns an error if the token
/// is empty or rejected — the caller should re-prompt the user for
/// credentials.
pub async fn login_with_refresh_token(
    app: &AppHandle,
    credentials: &SteamCredentials,
) -> Result<SteamClient<LoggedIn>> {
    let _ = debug_log::append(
        app,
        "steam.auth",
        &format!(
            "login_with_refresh_token username={} has_token={}",
            credentials.username,
            !credentials.refresh_token.is_empty()
        ),
    );

    if credentials.refresh_token.is_empty() {
        return Err(anyhow!(
            "No saved refresh token for {}. Sign in again.",
            credentials.username
        ));
    }

    LoginBuilder::new()
        .device_name(DEVICE_NAME)
        .with_refresh_token(credentials.username.clone(), credentials.refresh_token.clone())
        .login()
        .await
        .map_err(|err| anyhow!("{}", map_login_error("refresh_token", err)))
}

/// Authenticate using a username + password.
///
/// `guard_code` is set when the user types a Steam Guard code. Pass `None`
/// when Steam first demands a code and the renderer is just asking the
/// user "what should I do?" — the result will be `NeedsGuard` with metadata
/// about whether mobile-approval is also an option.
///
/// On success returns `Authenticated` with the rotated refresh token.
pub async fn login_with_credentials(
    app: &AppHandle,
    username: &str,
    password: &str,
    guard_code: Option<&str>,
) -> SteamLoginResult {
    let _ = debug_log::append(
        app,
        "steam.auth",
        &format!(
            "login_with_credentials username={} guard_code_provided={}",
            username,
            !guard_code.map(str::trim).unwrap_or("").is_empty()
        ),
    );

    let flow = match LoginBuilder::new()
        .device_name(DEVICE_NAME)
        .with_credentials(username.to_string(), password.to_string())
        .begin()
        .await
    {
        Ok(flow) => flow,
        Err(err) => {
            eprintln!("[steam.auth] login begin failed for {username}: {err}");
            return SteamLoginResult::Error {
                message: format!("Failed to start Steam login: {err}"),
            }
        }
    };

    eprintln!(
        "[steam.auth] login flow resolved for {username}: {}",
        match &flow {
            CredentialsLoginFlow::Approved(_) => "Approved",
            CredentialsLoginFlow::NeedsConfirmation(_) => "NeedsConfirmation",
            _ => "Other",
        }
    );

    match flow {
        CredentialsLoginFlow::Approved(approved) => finalize(username, approved).await,

        CredentialsLoginFlow::NeedsConfirmation(challenge) => {
            let can_use_mobile_approval = challenge.accepts_confirmation();

            if let Some(code) = guard_code.map(str::trim).filter(|c| !c.is_empty()) {
                return drive_guard_challenge(app, username, challenge, code).await;
            }

            if can_use_mobile_approval {
                let _ = debug_log::append(
                    app,
                    "steam.auth",
                    "no code submitted, mobile push was sent — polling for approval",
                );
                return drive_mobile_challenge(app, username, challenge).await;
            }

            SteamLoginResult::NeedsGuard {
                username: username.to_string(),
                can_use_mobile_approval,
            }
        }

        _ => SteamLoginResult::Error {
            message: "Steam returned an unrecognised login state. Update the launcher."
                .to_string(),
        },
    }
}

async fn finalize(
    username: &str,
    approved: steamroom_client::login::ApprovedAuth,
) -> SteamLoginResult {
    let tokens = approved.tokens();
    let account_name = tokens
        .account_name
        .clone()
        .unwrap_or_else(|| username.to_string());
    let refresh_token = tokens.refresh_token.clone();

    match approved.finish().await {
        Ok(_client) => SteamLoginResult::Authenticated(credentials_from_tokens(
            &account_name,
            &refresh_token,
            None,
        )),
        Err(err) => SteamLoginResult::Error {
            message: map_login_error("credentials_finish", err),
        },
    }
}

async fn drive_mobile_challenge(
    app: &AppHandle,
    username: &str,
    challenge: ConfirmationChallenge,
) -> SteamLoginResult {
    eprintln!("[steam.auth] drive_mobile_challenge entered for user={username}");
    let _ = debug_log::append(
        app,
        "steam.auth",
        "Guard challenge: awaiting mobile approval",
    );

    let emit_result = app.emit(
        STEAM_MOBILE_CONFIRMATION_PENDING_EVENT,
        serde_json::json!({ "username": username }),
    );
    eprintln!(
        "[steam.auth] emit({STEAM_MOBILE_CONFIRMATION_PENDING_EVENT}) -> {:?}",
        emit_result
    );
    let _ = debug_log::append(
        app,
        "steam.auth",
        &format!(
            "emit({}) -> {:?}",
            STEAM_MOBILE_CONFIRMATION_PENDING_EVENT, emit_result
        ),
    );

    match challenge.wait_for_confirmation().await {
        Ok(approved) => {
            eprintln!("[steam.auth] mobile confirmation APPROVED");
            let _ = debug_log::append(app, "steam.auth", "mobile confirmation approved");
            finalize(username, approved).await
        }
        Err(err) => {
            eprintln!("[steam.auth] mobile confirmation FAILED: {err}");
            let _ = debug_log::append(
                app,
                "steam.auth",
                &format!("mobile confirmation failed: {err}"),
            );
            SteamLoginResult::Error {
                message: map_login_error("wait_for_confirmation", err),
            }
        }
    }
}

async fn drive_guard_challenge(
    app: &AppHandle,
    username: &str,
    challenge: ConfirmationChallenge,
    code: &str,
) -> SteamLoginResult {
    let code_kinds = challenge.code_kinds();
    let kind = preferred_kind(code_kinds);
    let _ = debug_log::append(
        app,
        "steam.auth",
        &format!("submitting Steam Guard code ({kind:?})"),
    );

    match challenge.submit_code(code, kind).await {
        Ok(()) => match challenge.wait_for_tokens().await {
            Ok(tokens) => {
                let approved = challenge.into_approved(tokens);
                finalize(username, approved).await
            }
            Err(err) => SteamLoginResult::Error {
                message: map_login_error("wait_for_tokens", err),
            },
        },
        Err(LoginError::InvalidGuardCode) => SteamLoginResult::Error {
            message: "Invalid Steam Guard code. Please try again.".to_string(),
        },
        Err(err) => SteamLoginResult::Error {
            message: map_login_error("submit_code", err),
        },
    }
}

fn preferred_kind(kinds: &[GuardType]) -> GuardType {
    if kinds.contains(&GuardType::DeviceCode) {
        GuardType::DeviceCode
    } else if kinds.contains(&GuardType::EmailCode) {
        GuardType::EmailCode
    } else {
        kinds.first().copied().unwrap_or(GuardType::DeviceCode)
    }
}

fn map_login_error(stage: &str, err: LoginError) -> String {
    format!("Steam login failed at {stage}: {err}")
}

/// Persist the refresh token returned by `ApprovedAuth::tokens()` so future
/// launches can silently re-auth.
pub fn credentials_from_tokens(
    username: &str,
    refresh_token: &str,
    steam_id: Option<String>,
) -> SteamCredentials {
    SteamCredentials {
        username: username.to_string(),
        refresh_token: refresh_token.to_string(),
        steam_id,
        last_login_at: Some(Utc::now().timestamp()),
    }
}

/// One-shot login: try refresh-token first, fall back to error if the stored
/// token is empty or rejected. Returns `(client, fresh_refresh_token)` —
/// the token may differ from what was passed in because Steam rotates it.
pub async fn login(
    app: &AppHandle,
    credentials: SteamCredentials,
) -> Result<(SteamClient<LoggedIn>, String)> {
    if credentials.refresh_token.is_empty() {
        return Err(anyhow!(
            "No saved refresh token for {}. Sign in with password and Steam Guard.",
            credentials.username
        ));
    }

    let username = credentials.username.clone();
    let result = login_with_refresh_token(app, &credentials).await;
    match result {
        Ok(client) => Ok((client, credentials.refresh_token)),
        Err(err) => {
            let _ = debug_log::append(
                app,
                "steam.auth",
                &format!(
                    "refresh_token rejected for {username}: {err}; caller must re-auth with password"
                ),
            );
            Err(err)
        }
    }
}
