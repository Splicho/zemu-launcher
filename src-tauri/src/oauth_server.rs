use crate::auth;
use crate::debug_log;
use crate::models::OAuthCallbackPayload;
use crate::state::AppState;
use anyhow::{anyhow, Context, Result};
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use tiny_http::{Header, Method, Request, Response, Server};
use url::Url;

pub const CALLBACK_URL: &str = "http://localhost:31337/oauth/callback";
const LISTEN_ADDRESS: &str = "127.0.0.1:31337";
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(5 * 60);

pub struct OAuthCallbackServer {
    expected_state: String,
    cancel: Sender<()>,
    worker: JoinHandle<()>,
}

impl OAuthCallbackServer {
    fn stop(self) -> Result<()> {
        let _ = self.cancel.send(());
        self.worker
            .join()
            .map_err(|_| anyhow!("OAuth callback listener panicked"))
    }
}

#[derive(Debug, PartialEq)]
enum ListenerExit {
    CallbackReceived,
    TimedOut,
    Cancelled,
}

/// Each browser login owns a listener. A new attempt first stops the old one.
pub fn start_oauth_callback_server(app: &AppHandle, expected_state: &str) -> Result<()> {
    let app_state = app.state::<AppState>();
    let mut active = app_state
        .oauth_server
        .lock()
        .map_err(|_| anyhow!("OAuth server lock unavailable"))?;
    if let Some(previous) = active.take() {
        previous.stop()?;
    }

    let server = bind_server(LISTEN_ADDRESS)?;
    let (cancel, receiver) = mpsc::channel();
    let callback_state = expected_state.to_owned();
    let app = app.clone();
    let worker = std::thread::Builder::new()
        .name("oauth-callback".into())
        .spawn(move || {
            let _ = debug_log::append(&app, "oauth-server", "listening on 127.0.0.1:31337");
            let result = serve_callback(
                server,
                &callback_state,
                CALLBACK_TIMEOUT,
                receiver,
                |payload| {
                    auth::process_oauth_callback(&app, payload.token, payload.state, payload.error)
                },
            );
            let _ = debug_log::append(
                &app,
                "oauth-server",
                &format!("listener stopped: {result:?}"),
            );
            if matches!(result, Ok(ListenerExit::CallbackReceived)) {
                // Stopping the worker may join it from the UI thread. Queue focus
                // without waiting for that thread, after releasing the listener.
                let focus_app = app.clone();
                let _ = app.run_on_main_thread(move || {
                    crate::commands::focus_primary_window(&focus_app);
                });
            }
        })
        .context("Failed to start OAuth callback listener")?;
    *active = Some(OAuthCallbackServer {
        expected_state: expected_state.to_owned(),
        cancel,
        worker,
    });
    Ok(())
}

pub fn stop_oauth_callback_server(app: &AppHandle, expected_state: &str) -> Result<()> {
    let app_state = app.state::<AppState>();
    let mut active = app_state
        .oauth_server
        .lock()
        .map_err(|_| anyhow!("OAuth server lock unavailable"))?;
    if active.as_ref().map(|server| server.expected_state.as_str()) == Some(expected_state) {
        if let Some(server) = active.take() {
            server.stop()?;
        }
    }
    Ok(())
}

fn serve_callback(
    server: Server,
    expected_state: &str,
    timeout: Duration,
    cancel: Receiver<()>,
    mut callback: impl FnMut(OAuthCallbackPayload) -> Result<()>,
) -> Result<ListenerExit> {
    let deadline = Instant::now() + timeout;
    loop {
        match cancel.try_recv() {
            Ok(()) | Err(TryRecvError::Disconnected) => return Ok(ListenerExit::Cancelled),
            Err(TryRecvError::Empty) => {}
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Ok(ListenerExit::TimedOut);
        }
        let Some(request) = server.recv_timeout(remaining.min(Duration::from_millis(100)))? else {
            continue;
        };
        let mut received = false;
        let (status, body) = handle_request(request.method(), request.url(), |payload| {
            if payload.state.as_deref() != Some(expected_state) {
                return Err(anyhow!("Unexpected OAuth state"));
            }
            received = true;
            callback(payload)
        });
        respond(request, status, body);
        if received {
            // Dropping Server closes its listener, after the browser's reply.
            return Ok(ListenerExit::CallbackReceived);
        }
    }
}

fn bind_server(address: &str) -> Result<Server> {
    let deadline = Instant::now() + Duration::from_millis(250);
    loop {
        match Server::http(address) {
            Ok(server) => return Ok(server),
            Err(error) => {
                // tiny_http releases its listening socket on an internal thread.
                // Allow that thread to exit when a login attempt is restarted.
                let busy = error
                    .downcast_ref::<std::io::Error>()
                    .is_some_and(|error| error.kind() == std::io::ErrorKind::AddrInUse);
                if busy && Instant::now() < deadline {
                    std::thread::sleep(Duration::from_millis(10));
                    continue;
                }
                return Err(anyhow!("Cannot listen for OAuth on {address}: {error}. Close the application using this port and retry."));
            }
        }
    }
}

fn handle_request(
    method: &Method,
    raw_url: &str,
    callback: impl FnOnce(OAuthCallbackPayload) -> Result<()>,
) -> (u16, String) {
    if method != &Method::Get {
        return (405, "Method Not Allowed".into());
    }
    if !raw_url.starts_with('/') || raw_url.starts_with("//") {
        return (400, "Bad Request".into());
    }
    let Ok(url) = Url::parse(&format!("http://{LISTEN_ADDRESS}{raw_url}")) else {
        return (400, "Bad Request".into());
    };
    if url.path() != "/oauth/callback" && !url.path().starts_with("/auth/") {
        return (404, "Not Found".into());
    }

    let param = |name| {
        url.query_pairs()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.into_owned())
            .filter(|value| !value.is_empty())
    };
    let payload = OAuthCallbackPayload {
        token: param("token"),
        state: param("state"),
        error: param("error"),
    };
    if payload.state.is_none() || (payload.token.is_none() && payload.error.is_none()) {
        return (400, render_page(false, "Missing OAuth state or token."));
    }

    match callback(payload) {
        Ok(()) => (
            200,
            render_page(
                true,
                "Return to ZEmu Launcher to finish signing in. You can close this window.",
            ),
        ),
        Err(error) => (400, render_page(false, &error.to_string())),
    }
}

fn respond(request: Request, status: u16, body: String) {
    let mut response = Response::from_string(body).with_status_code(status);
    for (name, value) in [
        ("Content-Type", "text/html; charset=utf-8"),
        ("Cache-Control", "no-store"),
        ("Referrer-Policy", "no-referrer"),
    ] {
        if let Ok(header) = Header::from_bytes(name, value) {
            response = response.with_header(header);
        }
    }
    let _ = request.respond(response);
}

fn render_page(success: bool, message: &str) -> String {
    let title = if success {
        "Authentication Response Received"
    } else {
        "Authentication Failed"
    };
    let color = if success { "#4ade80" } else { "#f87171" };
    let message = message
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;");

    format!(
        "<!DOCTYPE html><html><head><title>OAuth Callback</title><style>body{{font-family:Arial,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a1a1a;color:#fff;}}.container{{text-align:center;padding:2rem;}}h1{{color:{color};}}</style></head><body><div class='container'><h1>{title}</h1><p>{message}</p></div></body></html>"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_requests_do_not_reach_auth() {
        for (method, url, status) in [
            (Method::Post, "/oauth/callback?state=test&token=test", 405),
            (Method::Get, "/favicon.ico", 404),
            (Method::Get, "//example.com/oauth/callback", 400),
            (Method::Get, "/oauth/callback?token=test", 400),
            (Method::Get, "/oauth/callback?state=test", 400),
            (Method::Get, "/oauth/callback?state=&token=test", 400),
        ] {
            assert_eq!(
                handle_request(&method, url, |_| panic!("unexpected callback")).0,
                status
            );
        }
    }

    #[test]
    fn rejected_callbacks_show_an_escaped_error() {
        let (status, body) = handle_request(
            &Method::Get,
            "/oauth/callback?state=test&error=access_denied",
            |payload| {
                assert_eq!(payload.error.as_deref(), Some("access_denied"));
                Err(anyhow!("Invalid state <script> & expired"))
            },
        );
        assert_eq!(status, 400);
        assert!(body.contains("Invalid state &lt;script&gt; &amp; expired"));
        assert!(!body.contains("<script>"));
    }

    #[test]
    fn occupied_port_is_reported() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap().to_string();
        let error = bind_server(&address).err().expect("port must be busy");
        assert!(error.to_string().contains("Cannot listen for OAuth"));
        drop(listener);
        assert!(bind_server(&address).is_ok());
    }

    #[tokio::test]
    async fn loopback_delivers_callback_and_returns_no_store_page() {
        let server = bind_server("127.0.0.1:0").unwrap();
        let address = server.server_addr().to_ip().unwrap();
        let (_cancel, receiver) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            serve_callback(
                server,
                "test-state",
                Duration::from_secs(5),
                receiver,
                |payload| {
                    assert_eq!(payload.state.as_deref(), Some("test-state"));
                    assert_eq!(payload.token.as_deref(), Some("test+token"));
                    Ok(())
                },
            )
            .unwrap()
        });
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        // Neither browser asset requests nor callbacks from another flow stop it.
        for (path, status) in [
            ("favicon.ico", 404),
            ("oauth/callback?state=other-state&token=test", 400),
        ] {
            assert_eq!(
                client
                    .get(format!("http://{address}/{path}"))
                    .send()
                    .await
                    .unwrap()
                    .status(),
                status
            );
            assert!(!worker.is_finished());
        }
        let response = client
            .get(format!(
                "http://{address}/oauth/callback?state=test-state&token=test%2Btoken"
            ))
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["cache-control"], "no-store");
        let body = response.text().await.unwrap();
        assert!(body.contains("Authentication Response Received"));
        assert!(!body.contains("test+token"));
        assert_eq!(worker.join().unwrap(), ListenerExit::CallbackReceived);
        assert!(
            bind_server(&address.to_string()).is_ok(),
            "listener must release the port for the next login"
        );
    }

    #[tokio::test]
    async fn provider_error_also_closes_listener() {
        let server = bind_server("127.0.0.1:0").unwrap();
        let address = server.server_addr().to_ip().unwrap();
        let (_cancel, receiver) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            serve_callback(
                server,
                "test-state",
                Duration::from_secs(5),
                receiver,
                |payload| {
                    assert_eq!(payload.error.as_deref(), Some("access_denied"));
                    Err(anyhow!("access_denied"))
                },
            )
            .unwrap()
        });
        let response = reqwest::Client::new()
            .get(format!(
                "http://{address}/oauth/callback?state=test-state&error=access_denied"
            ))
            .timeout(Duration::from_secs(5))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 400);
        assert!(response.text().await.unwrap().contains("access_denied"));
        assert_eq!(worker.join().unwrap(), ListenerExit::CallbackReceived);
        assert!(bind_server(&address.to_string()).is_ok());
    }

    #[test]
    fn timeout_releases_listener_without_renderer() {
        let server = bind_server("127.0.0.1:0").unwrap();
        let address = server.server_addr().to_ip().unwrap();
        let (_cancel, receiver) = mpsc::channel();
        assert_eq!(
            serve_callback(
                server,
                "test-state",
                Duration::from_millis(20),
                receiver,
                |_| panic!("unexpected callback")
            )
            .unwrap(),
            ListenerExit::TimedOut,
        );
        assert!(bind_server(&address.to_string()).is_ok());
    }

    #[test]
    fn explicit_cancellation_releases_listener() {
        let server = bind_server("127.0.0.1:0").unwrap();
        let address = server.server_addr().to_ip().unwrap();
        let (cancel, receiver) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            serve_callback(
                server,
                "test-state",
                Duration::from_secs(5),
                receiver,
                |_| panic!("unexpected callback"),
            )
            .unwrap()
        });
        cancel.send(()).unwrap();
        assert_eq!(worker.join().unwrap(), ListenerExit::Cancelled);
        assert!(bind_server(&address.to_string()).is_ok());
    }
}
