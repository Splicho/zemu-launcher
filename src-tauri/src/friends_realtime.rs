/**
 * Friends realtime socket client.
 *
 * Spawns a Socket.IO v4 connection from the Rust backend (not the renderer)
 * so the connection lifecycle and auth token are managed by the same
 * process that owns the persistent auth store. On each incoming
 * `friends:changed` event the module emits a Tauri `friends-changed`
 * event to the renderer, which invalidates the TanStack Query friends
 * cache and causes the FriendsPanel to re-fetch.
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
use crate::state::AppState;

/// Default realtime URL when AppState has none set (dev fallback).
const REALTIME_URL_DEFAULT: &str = "ws://localhost:3007";

/// Maximum reconnect back-off in seconds. Matches `rust_socketio`'s `reconnect_delay`.
const MAX_BACKOFF_SECS: u64 = 30;

/// The Tauri event name the renderer listens for.
const TAURI_EVENT: &str = "friends:changed";

/// Resolve the realtime URL from AppState (set by the renderer on startup).
fn realtime_url(app: &AppHandle) -> String {
    app.try_state::<AppState>()
        .and_then(|s| s.get_realtime_url())
        .unwrap_or_else(|| REALTIME_URL_DEFAULT.to_string())
}

/**
 * Start the realtime socket for the given app handle.
 *
 * Called once from `lib.rs`'s `setup` after windows are built. Spawns a
 * background Tokio task that owns the socket. The socket's internal reconnect
 * loop handles network outages. The task exits when `shutdown_rx` resolves
 * (sender dropped on app exit).
 */
pub fn spawn(app: AppHandle, shutdown_rx: tokio::sync::oneshot::Receiver<()>) {
    let url = realtime_url(&app);
    info!(url = %url, "realtime: starting");

    tauri::async_runtime::spawn(async move {
        // Shared shutdown flag — set to true when the oneshot sender is dropped
        // (app exiting).
        let shutdown = Arc::new(AtomicBool::new(false));

        // Watchdog: waits for the oneshot to close, then sets the flag.
        let shutdown_rx = shutdown_rx;
        let shutdown_flag = shutdown.clone();
        let _watchdog = tauri::async_runtime::spawn(async move {
            let _ = shutdown_rx.await;
            shutdown_flag.store(true, Ordering::SeqCst);
            info!("realtime: watchdog: app shutting down");
        });

        // Read the token once. We deliberately do NOT re-read on reconnect:
        // the server verifies the token at handshake time. If the token
        // has expired between connections, the server closes it and the
        // error handler logs it; a fresh token from the next OAuth flow
        // will be used on the next app restart.
        let token = match get_token(&app) {
            Ok(Some(auth)) if !auth.token.is_empty() => auth.token,
            Ok(_) => {
                warn!("realtime: no auth token yet; connecting without authentication");
                String::new()
            }
            Err(e) => {
                warn!(err = %e, "realtime: failed to read auth token; connecting without it");
                String::new()
            }
        };

        let app_handle = app.clone();
        let app_handle2 = app.clone();
        let token_for_connect = token.clone();

        // Build and connect the socket. `rust_socketio` owns the reconnect
        // loop; we just hold the `Client` and let it run.
        let _socket = match ClientBuilder::new(&url)
            .auth(json!({ "token": token }))
            .transport_type(rust_socketio::TransportType::Websocket)
            .reconnect(true)
            .reconnect_delay(1, MAX_BACKOFF_SECS)
            // `connect` fires on initial connect AND after each reconnect.
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
                        } else {
                            info!(room = %room, "realtime: joined room");
                        }
                    }

                    if let Err(e) = app.emit(TAURI_EVENT, ()) {
                        error!(err = %e, "realtime: connect-event emit failed");
                    }
                }
                .boxed()
            })
            .on("friends:changed", move |_payload: Payload, _socket| {
                let app = app_handle2.clone();
                async move {
                    info!("realtime: received friends:changed");
                    if let Err(e) = app.emit(TAURI_EVENT, ()) {
                        error!(err = %e, "realtime: emit failed");
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
                }
                .boxed()
            })
            .connect()
            .await
        {
            Ok(s) => {
                info!("realtime: socket connected");
                s
            }
            Err(e) => {
                error!(err = %e, "realtime: initial connection failed");
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
