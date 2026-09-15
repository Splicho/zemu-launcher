/**
 * Friends realtime socket client.
 *
 * Spawns a Socket.IO v4 connection from the Rust backend (not the renderer)
 * so the connection lifecycle and auth token are managed by the same
 * process that owns the persistent auth store. On each incoming
 * `friends:changed` event the module parses the payload, extracts the `kind`
 * field, and emits one of two typed Tauri events to the renderer:
 *
 *   - `friends:incoming-request`  → payload: `{ fromUser: { id, displayName, avatarUrl } }`
 *   - `friends:graph-changed`     → payload: `()`
 *
 * `rust_socketio` handles network disconnect / reconnect internally with
 * exponential back-off (1 s → 30 s cap, `reconnect: true`).
 * The watchdog task detects app exit and stops the task promptly.
 *
 * The URL is read from `AppState.realtime_url`, which the renderer sets
 * once on startup via `launcher_set_realtime_url`. Dev default:
 * ws://localhost:3007. Prod default: wss://socket.zemu.uk.
 */
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Result};
use futures_util::FutureExt;
use rust_socketio::{asynchronous::ClientBuilder, Payload};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};
use tracing::{error, info, warn};

use crate::auth::get_token;
use crate::friends_debug_log;
use crate::state::AppState;

/// Default realtime URL when AppState has none set (dev fallback).
/// Only used as a last-resort fallback when the renderer fails to push
/// a URL within `REALTIME_URL_WAIT_TIMEOUT` — in production the
/// renderer always wins with `wss://socket.zemu.uk`.
#[allow(dead_code)]
const REALTIME_URL_DEFAULT: &str = "ws://localhost:3007";

/// Maximum reconnect back-off in seconds. Matches `rust_socketio`'s `reconnect_delay`.
const MAX_BACKOFF_SECS: u64 = 30;

/// How long to wait for the renderer to push a realtime URL before
/// falling back to `REALTIME_URL_DEFAULT`. Long enough to survive a
/// slow webview boot (cold start, dev server compile) but short
/// enough that a renderer that crashed still surfaces a clear
/// "ws://localhost:3007 in production" log instead of hanging
/// forever.
const REALTIME_URL_WAIT_TIMEOUT: Duration = Duration::from_secs(10);

/// Tauri event emitted when the friends graph changed and the panel should
/// refetch (decline, cancel, remove, or any other non-toast action).
const GRAPH_CHANGED_EVENT: &str = "friends:graph-changed";

/// Tauri event emitted when another user sent the signed-in user a friend
/// request. Payload is `FriendsIncomingRequestPayload` (see below).
const INCOMING_REQUEST_EVENT: &str = "friends:incoming-request";

/// Payload forwarded as the `friends:incoming-request` Tauri event.
///
/// Defined inline in the `on("friends:changed", …)` handler so the types
/// are co-located with the parsing logic. Extracted into module-level
/// structs would require a `#[serde(deserialize_with)]` helper to handle
/// the snake_case / camelCase mismatch between the api's payload and the
/// Rust struct fields — not worth the ceremony for a single call site.

/// Wait for the renderer to push a realtime URL via
/// `launcher_set_realtime_url`. Returns the URL when one arrives, or
/// `None` on shutdown or timeout.
///
/// The watcher fires on every `set_realtime_url` call, but we only
/// care about the first one — the URL is a startup-time config, not
/// something that changes during the session.
async fn resolve_realtime_url(
    mut url_rx: tokio::sync::watch::Receiver<Option<String>>,
    app: &AppHandle,
    shutdown_flag: &Arc<AtomicBool>,
) -> Option<String> {
    // If the renderer already pushed a URL (e.g. on a re-spawn), use it
    // without waiting.
    if let Some(url) = url_rx.borrow().clone() {
        if !url.is_empty() {
            return Some(url);
        }
    }

    friends_debug_log::write_with_app(
        app,
        "rt-start",
        "renderer URL not yet pushed — waiting",
    );

    let deadline = tokio::time::Instant::now() + REALTIME_URL_WAIT_TIMEOUT;
    loop {
        if shutdown_flag.load(Ordering::SeqCst) {
            info!("realtime: shutdown while waiting for URL");
            return None;
        }
        // `changed()` resolves on every value update. We re-check the
        // value afterwards so we don't miss an update that lands
        // between the deadline check and the await.
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            warn!(
                "realtime: renderer never pushed a URL within {:?}; giving up",
                REALTIME_URL_WAIT_TIMEOUT
            );
            friends_debug_log::write_with_app(
                app,
                "rt-start",
                &format!(
                    "renderer never pushed a URL within {:?}; giving up",
                    REALTIME_URL_WAIT_TIMEOUT
                ),
            );
            return None;
        }
        let _ = tokio::time::timeout(remaining, url_rx.changed()).await;
        if let Some(url) = url_rx.borrow().clone() {
            if !url.is_empty() {
                return Some(url);
            }
        }
    }
}

/**
 * Start the realtime socket for the given app handle.
 *
 * Called once from `lib.rs`'s `setup` after windows are built. Spawns a
 * background Tokio task that owns the socket. The socket's internal reconnect
 * loop handles network outages. The task exits when `shutdown_rx` resolves
 * (sender dropped on app exit).
 *
 * URL resolution: the task **waits** for the renderer to push a URL via
 * `launcher_set_realtime_url` before connecting. This is necessary because
 * Rust's `setup` runs synchronously at app boot — well before the
 * webview has loaded `main.tsx` and executed `syncLauncherRuntimeConfig`.
 * Without the wait, the task would fall back to the dev default
 * (`ws://localhost:3007`) in every production build. The wait is
 * bounded by `REALTIME_URL_WAIT_TIMEOUT` so a renderer that crashed
 * never hangs the socket task forever.
 */
pub fn spawn(app: AppHandle, shutdown_rx: tokio::sync::oneshot::Receiver<()>) {
    info!("realtime: starting (waiting for renderer to push URL)");
    friends_debug_log::write_with_app(
        &app,
        "rt-start",
        "realtime task spawning (waiting for renderer to push real URL)",
    );

    tauri::async_runtime::spawn({
        async move {
        // Shared shutdown flag — set to true when the oneshot sender is dropped
        // (app exiting).
        let shutdown = Arc::new(AtomicBool::new(false));

        // Watchdog: waits for the oneshot to close, then sets the flag.
        let shutdown_rx = shutdown_rx;
        let watchdog_shutdown = shutdown.clone();
        let _watchdog = tauri::async_runtime::spawn(async move {
            let _ = shutdown_rx.await;
            watchdog_shutdown.store(true, Ordering::SeqCst);
            info!("realtime: watchdog: app shutting down");
        });

        // Subscribe to the watch channel so the realtime task can wait
        // for the renderer to push a URL before connecting. Rust's
        // `setup` runs synchronously at app boot — well before the
        // webview has loaded `main.tsx` — so without this wait the
        // task would fall back to the dev default (`ws://localhost:3007`)
        // in every production build.
        let url_rx = match app.try_state::<AppState>() {
            Some(state) => state.subscribe_realtime_url(),
            None => {
                error!("realtime: AppState not registered; cannot subscribe to URL changes");
                friends_debug_log::write_with_app(
                    &app,
                    "rt-start",
                    "AppState not registered; cannot subscribe to URL changes",
                );
                return;
            }
        };

        let shutdown_flag = shutdown.clone();
        let url = match resolve_realtime_url(url_rx, &app, &shutdown_flag).await {
            Some(u) => u,
            None => return, // shutdown or timeout already logged
        };
        info!(url = %url, "realtime: using URL");
        friends_debug_log::write_with_app(
            &app,
            "rt-start",
            &format!("resolved realtime url={url}"),
        );

        // Read the token once. We deliberately do NOT re-read on reconnect:
        // the server verifies the token at handshake time. If the token
        // has expired between connections, the server closes it and the
        // error handler logs it; a fresh token from the next OAuth flow
        // will be used on the next app restart.
        let token = match get_token(&app) {
            Ok(Some(auth)) if !auth.token.is_empty() => {
                friends_debug_log::write_with_app(
                    &app,
                    "rt-start",
                    &format!("auth token loaded: token_len={}", auth.token.len()),
                );
                auth.token
            }
            Ok(_) => {
                warn!("realtime: no auth token yet; connecting without authentication");
                friends_debug_log::write_with_app(
                    &app,
                    "rt-start",
                    "auth token: none — connecting without authentication",
                );
                String::new()
            }
            Err(e) => {
                warn!(err = %e, "realtime: failed to read auth token; connecting without it");
                friends_debug_log::write_with_app(
                    &app,
                    "rt-start",
                    &format!("auth token read failed: {e}"),
                );
                String::new()
            }
        };

        let app_handle = app.clone();
        let app_handle2 = app.clone();
        let token_for_connect = token.clone();

        // Build and connect the socket. `rust_socketio` owns the reconnect
        // loop; we just hold the `Client` and let it run.
        let url_for_log = url.clone();
        let url_for_connect_log = url.clone();
        let _socket = match ClientBuilder::new(&url)
            .auth(json!({ "token": token }))
            .transport_type(rust_socketio::TransportType::Websocket)
            .reconnect(true)
            .reconnect_delay(1, MAX_BACKOFF_SECS)
            // `connect` fires on initial connect AND after each reconnect.
            // Join the user's private room on connect so the realtime server
            // can route events to us.
            .on("connect", move |_payload: Payload, socket| {
                let app = app_handle.clone();
                let token = token_for_connect.clone();
                let url_log = url_for_log.clone();
                async move {
                    let room = extract_user_id_from_token(&token)
                        .map(|uid| format!("user:{uid}"))
                        .unwrap_or_default();

                    friends_debug_log::write_with_app(
                        &app,
                        "rt-connect",
                        &format!(
                            "socket=connected url={url_log} room={}",
                            if room.is_empty() { "(none — no token)".to_string() } else { room.clone() }
                        ),
                    );

                    if !room.is_empty() {
                        if let Err(e) = socket.emit("join", json!({ "room": room })).await {
                            warn!(err = %e, room = %room, "realtime: join emit failed");
                            friends_debug_log::write_with_app(
                                &app,
                                "rt-connect",
                                &format!("join emit failed: room={room} err={e}"),
                            );
                        } else {
                            info!(room = %room, "realtime: joined room");
                            friends_debug_log::write_with_app(
                                &app,
                                "rt-connect",
                                &format!("joined room={room}"),
                            );
                        }
                    }
                    // Emit the generic graph-changed event so the friends panel
                    // refetches on connect/reconnect (e.g. after a network blip).
                    if let Err(e) = app.emit(GRAPH_CHANGED_EVENT, ()) {
                        error!(err = %e, "realtime: connect-event emit failed");
                        friends_debug_log::write_with_app(
                            &app,
                            "rt-connect",
                            &format!("graph-changed emit failed: {e}"),
                        );
                    }
                }
                .boxed()
            })
            .on("friends:changed", move |payload: Payload, _socket| {
                let app = app_handle2.clone();
                async move {
                    // Normalize any payload variant to a JSON value.
                    let json_value = match payload {
                        Payload::Text(vals) => vals.first().cloned().unwrap_or(serde_json::Value::Null),
                        Payload::Binary(data) => {
                            serde_json::from_slice(&data).unwrap_or(serde_json::Value::Null)
                        }
                        #[allow(deprecated)]
                        Payload::String(s) => serde_json::Value::String(s),
                    };

                    // Log every raw payload (truncated) before parsing, so
                    // we can spot malformed events from the realtime
                    // server at a glance.
                    friends_debug_log::write_with_app(
                        &app,
                        "rt-receive",
                        &format!("friends:changed raw_payload={json_value}"),
                    );

                    // Parse the `kind` discriminator.
                    let kind = json_value
                        .get("kind")
                        .and_then(|v| v.as_str())
                        .unwrap_or("invalidate");

                    match kind {
                        "incoming_request" => {
                            // Extract `fromUser` from the payload and forward it
                            // as the typed Tauri event.
                            let from_user = json_value.get("fromUser");
                            let payload = serde_json::json!({
                                "fromUser": {
                                    "id": from_user.and_then(|o| o.get("id")).and_then(|v| v.as_str()).unwrap_or_default(),
                                    "displayName": from_user.and_then(|o| o.get("displayName")).and_then(|v| v.as_str()).or(from_user.and_then(|o| o.get("display_name")).and_then(|v| v.as_str())),
                                    "avatarUrl": from_user.and_then(|o| o.get("avatarUrl")).and_then(|v| v.as_str()).or(from_user.and_then(|o| o.get("avatar_url")).and_then(|v| v.as_str())),
                                }
                            });
                            let log_payload = payload.clone();
                            info!(?payload, "realtime: incoming_request → friends:incoming-request");
                            if let Err(e) = app.emit(INCOMING_REQUEST_EVENT, payload) {
                                error!(err = %e, "realtime: emit friends:incoming-request failed");
                                friends_debug_log::write_with_app(
                                    &app,
                                    "rt-emit",
                                    &format!(
                                        "emit friends:incoming-request FAILED payload={log_payload} err={e}"
                                    ),
                                );
                            } else {
                                friends_debug_log::write_with_app(
                                    &app,
                                    "rt-emit",
                                    &format!("emit friends:incoming-request ok payload={log_payload}"),
                                );
                            }
                        }
                        _ => {
                            // All other kinds (accepted, invalidate, decline, cancel, etc.)
                            // are treated as a generic graph invalidation.
                            info!(kind = %kind, "realtime: graph-changed");
                            if let Err(e) = app.emit(GRAPH_CHANGED_EVENT, ()) {
                                error!(err = %e, "realtime: emit friends:graph-changed failed");
                                friends_debug_log::write_with_app(
                                    &app,
                                    "rt-emit",
                                    &format!("emit friends:graph-changed FAILED kind={kind} err={e}"),
                                );
                            } else {
                                friends_debug_log::write_with_app(
                                    &app,
                                    "rt-emit",
                                    &format!("emit friends:graph-changed ok kind={kind}"),
                                );
                            }
                        }
                    }
                }
                .boxed()
            })
            .on("error", |payload: Payload, _socket| {
                async move {
                    // Normalize `Payload::String` (deprecated) to `Payload::Text`.
                    let payload_normalized = match payload {
                        Payload::Text(_) => payload,
                        Payload::Binary(_) => payload,
                        #[allow(deprecated)]
                        Payload::String(s) => Payload::Text(vec![s.into()]),
                    };
                    let msg = match payload_normalized {
                        Payload::Text(vals) => vals
                            .iter()
                            .map(|v| v.as_str().unwrap_or("?"))
                            .collect::<Vec<_>>()
                            .join(", "),
                        Payload::Binary(data) => format!("[binary {} bytes]", data.len()),
                        #[allow(deprecated)]
                        Payload::String(s) => s,
                    };
                    warn!(msg = %msg, "realtime: socket error");
                    friends_debug_log::write("rt-error", &format!("{msg}"));
                }
                .boxed()
            })
            .connect()
            .await
        {
            Ok(s) => {
                info!("realtime: socket connected");
                friends_debug_log::write_with_app(
                    &app,
                    "rt-connect",
                    &format!("initial connect succeeded url={url_for_connect_log}"),
                );
                s
            }
            Err(e) => {
                error!(err = %e, "realtime: initial connection failed");
                friends_debug_log::write_with_app(
                    &app,
                    "rt-connect",
                    &format!("initial connect FAILED url={url_for_connect_log} err={e}"),
                );
                return;
            }
        };

        // Wait for app shutdown. `rust_socketio`'s internal reconnect keeps
        // the socket alive through network outages. Dropping `socket` here
        // (when the task exits) disconnects gracefully.
        while !shutdown.load(Ordering::SeqCst) {
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        info!("realtime: shutdown received");
        }
    });
}

/** Extract the `sub` claim from a JWT without verifying the signature. */
fn extract_user_id_from_token(token: &str) -> Option<String> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let payload_bytes = base64_decode_url(parts[1]).ok()?;
    let json: serde_json::Value = serde_json::from_slice(&payload_bytes).ok()?;
    let sub_str = json.get("sub")?.as_str()?;
    if sub_str.is_empty() {
        return None;
    }
    Some(sub_str.to_string())
}

/** Decode a base64url-encoded slice (URL-safe alphabet, no padding required). */
fn base64_decode_url(input: &str) -> Result<Vec<u8>> {
    let padded = match input.len() % 4 {
        0 => input.to_string(),
        2 => format!("{input}=="),
        3 => format!("{input}="),
        _ => return Err(anyhow!("invalid base64url input length")),
    };
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    base64::Engine::decode(&URL_SAFE_NO_PAD, &padded)
        .map_err(|e| anyhow!("base64url decode failed: {e}"))
}
