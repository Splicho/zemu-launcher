use crate::auth;
use crate::debug_log;
use crate::state::AppState;
use tauri::AppHandle;
use tiny_http::{Header, Response, Server};
use url::Url;

/// Spins up a localhost HTTP server that the OAuth callback page hits with
/// `?token=...&state=...`. Dev runtime uses this; in production we also
/// rely on the deep-link plugin to receive the same callback when the user
/// clicks the launcher back into focus.
pub fn start_oauth_callback_server(app: AppHandle, state: AppState) {
    if !state.mark_oauth_server_started() {
        let _ = debug_log::append(&app, "oauth-server", "start skipped (already started)");
        return;
    }

    std::thread::spawn(move || {
        let server = match Server::http("127.0.0.1:31337") {
            Ok(server) => {
                let _ = debug_log::append(&app, "oauth-server", "listening on 127.0.0.1:31337");
                server
            }
            Err(error) => {
                let _ = debug_log::append(
                    &app,
                    "oauth-server",
                    &format!("failed to bind server: {error}"),
                );
                return;
            }
        };

        for request in server.incoming_requests() {
            let raw_url = request.url().to_string();
            let _ = debug_log::append(&app, "oauth-server", &format!("incoming request={raw_url}"));
            let parsed = Url::parse(&format!("http://localhost:31337{}", raw_url));

            let (status_code, body) = match parsed {
                Ok(url) => {
                    let path = url.path();
                    if path == "/oauth/callback" || path.starts_with("/auth/") {
                        let token = url
                            .query_pairs()
                            .find(|(k, _)| k == "token")
                            .map(|(_, v)| v.to_string());
                        let state_value = url
                            .query_pairs()
                            .find(|(k, _)| k == "state")
                            .map(|(_, v)| v.to_string());
                        let error = url
                            .query_pairs()
                            .find(|(k, _)| k == "error")
                            .map(|(_, v)| v.to_string());
                        let _ = debug_log::append(
                            &app,
                            "oauth-server",
                            &format!(
                                "callback parsed token_present={} state_present={} error_present={}",
                                token.is_some(),
                                state_value.is_some(),
                                error.is_some()
                            ),
                        );

                        auth::process_oauth_callback(&app, token, state_value, error.clone());

                        let html = if let Some(err) = error {
                            render_page(false, &err)
                        } else {
                            render_page(true, "You can close this window.")
                        };
                        (200, html)
                    } else {
                        let _ = debug_log::append(
                            &app,
                            "oauth-server",
                            &format!("unknown path={path}"),
                        );
                        (404, "Not Found".to_string())
                    }
                }
                Err(error) => {
                    let _ = debug_log::append(
                        &app,
                        "oauth-server",
                        &format!("invalid request URL: {error}"),
                    );
                    (400, "Bad Request".to_string())
                }
            };

            let mut response = Response::from_string(body).with_status_code(status_code);
            if let Ok(header) =
                Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..])
            {
                response = response.with_header(header);
            }
            let _ = request.respond(response);
            let _ = debug_log::append(
                &app,
                "oauth-server",
                &format!("response status={status_code}"),
            );
        }
    });
}

fn render_page(success: bool, message: &str) -> String {
    let title = if success {
        "Authentication Successful"
    } else {
        "Authentication Failed"
    };
    let color = if success { "#4ade80" } else { "#f87171" };

    format!(
        "<!DOCTYPE html><html><head><title>OAuth Callback</title><style>body{{font-family:Arial,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a1a1a;color:#fff;}}.container{{text-align:center;padding:2rem;}}h1{{color:{color};}}</style></head><body><div class='container'><h1>{title}</h1><p>{message}</p></div></body></html>"
    )
}
