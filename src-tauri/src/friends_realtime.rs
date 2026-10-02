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
 * The URL is read from `AppState.realtime_url`, populated at
 * construction time from `crate::config::REALTIME_URL` (set by
 * `build.rs` from `LAUNCHER_CONFIG.realtimeUrl`). Dev override:
 * `LAUNCHER_REALTIME_URL` env var. Prod default: wss://socket.zemu.uk.
 */
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Result};
use futures_util::FutureExt;
use rust_socketio::{asynchronous::ClientBuilder, Payload};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};
use tracing::{error, warn};

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

/// Tauri event emitted when a friend's (or the signed-in user's own)
/// presence snapshot changes — status / currentGame / lastSeenAt.
/// Payload is `FriendsPresenceUpdatedPayload` (see
/// `useFriendsPresence` in the renderer). The renderer patches its
/// cached friends in place when it receives this so the avatar-badge
/// dot and "Currently playing" sub-line update without a refetch.
const PRESENCE_UPDATED_EVENT: &str = "friends:presence-updated";

/// Payload forwarded as the `friends:incoming-request` Tauri event.
///
/// Defined inline in the `on("friends:changed", …)` handler so the types
/// are co-located with the parsing logic. Extracted into module-level
/// structs would require a `#[serde(deserialize_with)]` helper to handle
/// the snake_case / camelCase mismatch between the api's payload and the
/// Rust struct fields — not worth the ceremony for a single call site.

/// Read the realtime URL pushed at `AppState::new` time.
///
/// The URL is now compile-time-bundled (`crate::config::REALTIME_URL`,
/// overridable in dev via the `LAUNCHER_REALTIME_URL` env var) — the
/// renderer no longer has a setter for it. The receiver here is kept
/// for API symmetry with `subscribe_realtime_url` (so the realtime
/// task can wait one tick on construction), but in practice the
/// initial value is already populated.
async fn resolve_realtime_url(
    mut url_rx: tokio::sync::watch::Receiver<Option<String>>,
    app: &AppHandle,
    shutdown_flag: &Arc<AtomicBool>,
) -> Option<String> {
    if let Some(url) = url_rx.borrow().clone() {
        if !url.is_empty() {
            return Some(url);
        }
    }

    // Bundled URL was somehow missing — wait briefly for it to
    // appear. In practice the timeout path below is hit on a broken
    // build, not on a healthy one.
    let deadline = tokio::time::Instant::now() + REALTIME_URL_WAIT_TIMEOUT;
    loop {
        if shutdown_flag.load(Ordering::SeqCst) {
            return None;
        }
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            warn!(
                "realtime: bundled URL never arrived within {:?}; giving up",
                REALTIME_URL_WAIT_TIMEOUT
            );
            friends_debug_log::write_with_app(
                app,
                "rt-start",
                &format!(
                    "bundled URL never arrived within {:?}; giving up",
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
 * URL resolution: the URL is bundled into `AppState` at
 * construction time (`crate::config::REALTIME_URL`, overrideable in
 * dev via `LAUNCHER_REALTIME_URL`). The realtime task subscribes to
 * the watch channel anyway so it can pick up future updates from
 * the bundled initial value.
 */
pub fn spawn(app: AppHandle, shutdown_rx: tokio::sync::oneshot::Receiver<()>) {
    friends_debug_log::write_with_app(
        &app,
        "rt-start",
        "realtime task spawning (URL bundled into AppState at construction)",
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
        });

        // Subscribe to the watch channel so the realtime task can
        // pick up URL updates at boot. The initial value is already
        // populated (AppState was constructed with the bundled URL),
        // so no renderer round-trip is needed.
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

        // Read the token once. We deliberately do NOT re-read on reconnect:
        // the server verifies the token at handshake time. If the token
        // has expired between connections, the server closes it and the
        // error handler logs it; a fresh token from the next OAuth flow
        // will be used on the next app restart.
        let token = match get_token(&app) {
            Ok(Some(auth)) if !auth.token.is_empty() => auth.token,
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
        let app_handle3 = app.clone();
        let token_for_connect = token.clone();

        // Build and connect the socket. `rust_socketio` owns the reconnect
        // loop; we just hold the `Client` and let it run.
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
                async move {
                    let room = extract_user_id_from_token(&token)
                        .map(|uid| format!("user:{uid}"))
                        .unwrap_or_default();

                    if !room.is_empty() {
                        if let Err(e) = socket.emit("join", json!({ "room": room })).await {
                            warn!(err = %e, room = %room, "realtime: join emit failed");
                            friends_debug_log::write_with_app(
                                &app,
                                "rt-connect",
                                &format!("join emit failed: room={room} err={e}"),
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
                            if let Err(e) = app.emit(INCOMING_REQUEST_EVENT, payload) {
                                error!(err = %e, "realtime: emit friends:incoming-request failed");
                                friends_debug_log::write_with_app(
                                    &app,
                                    "rt-emit",
                                    &format!("emit friends:incoming-request FAILED err={e}"),
                                );
                            }
                            // Also invalidate the friends graph so the
                            // sidebar's incoming-requests badge updates
                            // even when the toast hook isn't mounted
                            // (e.g. logged-out user). Cheap and idempotent.
                            if let Err(e) = app.emit(GRAPH_CHANGED_EVENT, ()) {
                                error!(err = %e, "realtime: emit friends:graph-changed (alongside incoming-request) failed");
                            }
                        }
                        _ => {
                            // All other kinds (accepted, invalidate, decline, cancel, etc.)
                            // are treated as a generic graph invalidation.
                            if let Err(e) = app.emit(GRAPH_CHANGED_EVENT, ()) {
                                error!(err = %e, "realtime: emit friends:graph-changed failed");
                                friends_debug_log::write_with_app(
                                    &app,
                                    "rt-emit",
                                    &format!("emit friends:graph-changed FAILED kind={kind} err={e}"),
                                );
                            }
                        }
                    }
                }
                .boxed()
            })
            .on("presence:updated", move |payload: Payload, _socket| {
                let app = app_handle3.clone();
                async move {
                    // Normalize any payload variant to a JSON value, mirroring
                    // the `friends:changed` handler above. Presence payloads
                    // are tiny (a few fields) so the same Text/Binary/String
                    // dance is fine here.
                    let json_value = match payload {
                        Payload::Text(vals) => vals.first().cloned().unwrap_or(serde_json::Value::Null),
                        Payload::Binary(data) => {
                            serde_json::from_slice(&data).unwrap_or(serde_json::Value::Null)
                        }
                        #[allow(deprecated)]
                        Payload::String(s) => serde_json::Value::String(s),
                    };

                    // Extract the four fields we forward. Any field missing
                    // from the payload is treated as an empty / null default
                    // — a malformed server-side event must not panic the
                    // socket task, and a partially-populated event still
                    // gives the renderer something useful.
                    let user_id = json_value
                        .get("userId")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();
                    let status = json_value
                        .get("status")
                        .and_then(|v| v.as_str())
                        .unwrap_or("online")
                        .to_string();
                    let current_game = json_value
                        .get("currentGame")
                        .and_then(|v| v.as_str())
                        .map(str::to_string);
                    let last_seen_at = json_value
                        .get("lastSeenAt")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();

                    if user_id.is_empty() {
                        warn!("realtime: presence:updated missing userId; dropping");
                        return;
                    }

                    let payload = serde_json::json!({
                        "userId": user_id,
                        "status": status,
                        "currentGame": current_game,
                        "lastSeenAt": last_seen_at,
                    });
                    if let Err(e) = app.emit(PRESENCE_UPDATED_EVENT, payload) {
                        error!(err = %e, "realtime: emit friends:presence-updated failed");
                        friends_debug_log::write_with_app(
                            &app,
                            "rt-emit",
                            &format!("emit friends:presence-updated FAILED err={e}"),
                        );
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
            Ok(s) => s,
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
