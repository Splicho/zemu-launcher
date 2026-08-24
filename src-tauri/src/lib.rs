mod api;
mod auth;
mod commands;
mod debug_log;
mod discord;
mod game;
mod models;
mod oauth_server;
mod state;
mod storage;
mod update;

use state::AppState;
use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;
use url::Url;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState::default();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            commands::focus_primary_window(app);

            let protocol_prefix = configured_protocol_prefix(app);
            if let Some(url) = args
                .iter()
                .find(|arg| is_oauth_callback_arg(arg, protocol_prefix.as_deref()))
            {
                handle_protocol_url(app, url);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(app_state.clone())
        .invoke_handler(commands::register_commands())
        .setup(move |app| {
            if app.get_webview_window("bootstrap").is_some() {
                app_state.mark_bootstrap_active();
            }
            discord::initialize(app.handle());
            let _ = debug_log::append(
                app.handle(),
                "app",
                &format!(
                    "startup version={} packaged={} args={}",
                    env!("CARGO_PKG_VERSION"),
                    !cfg!(debug_assertions),
                    std::env::args().count()
                ),
            );
            let _ = debug_log::append(
                app.handle(),
                "app",
                &format!("log_path={}", debug_log::log_path_string(app.handle())),
            );
            if let Err(error) = discord::set_in_launcher(app.handle()) {
                let _ = debug_log::append(
                    app.handle(),
                    "discord",
                    &format!("failed to queue initial launcher activity: {error}"),
                );
            }

            oauth_server::start_oauth_callback_server(app.handle().clone(), app_state.clone());

            #[cfg(any(target_os = "linux", windows))]
            {
                if let Err(error) = app.deep_link().register_all() {
                    let _ = debug_log::append(
                        app.handle(),
                        "deep-link",
                        &format!("register_all failed: {error}"),
                    );
                } else {
                    let _ = debug_log::append(app.handle(), "deep-link", "register_all succeeded");
                }
            }

            let app_handle = app.handle().clone();
            let _ = app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    let _ = debug_log::append(
                        &app_handle,
                        "deep-link",
                        &format!("on_open_url={}", url.as_str()),
                    );
                    handle_protocol_url(&app_handle, url.as_str());
                }
            });

            let startup_args: Vec<String> = std::env::args().collect();
            let protocol_prefix = configured_protocol_prefix(app.handle());
            if let Some(url) = startup_args
                .iter()
                .find(|arg| is_oauth_callback_arg(arg, protocol_prefix.as_deref()))
            {
                let _ = debug_log::append(
                    app.handle(),
                    "deep-link",
                    &format!("startup_protocol_arg={url}"),
                );
                handle_protocol_url(app.handle(), url);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn configured_protocol_prefix(app: &tauri::AppHandle) -> Option<String> {
    storage::detect_oauth_callback_protocol(app)
        .ok()
        .and_then(|protocol| protocol)
}

fn is_oauth_callback_arg(raw: &str, protocol_prefix: Option<&str>) -> bool {
    if let Some(prefix) = protocol_prefix {
        return raw.starts_with(prefix);
    }

    raw.contains("://oauth/callback")
}

fn handle_protocol_url(app: &tauri::AppHandle, raw_url: &str) {
    let _ = debug_log::append(app, "protocol", &format!("received_url={raw_url}"));
    if let Ok(parsed) = Url::parse(raw_url) {
        let token = parsed
            .query_pairs()
            .find(|(k, _)| k == "token")
            .map(|(_, v)| v.to_string());
        let state = parsed
            .query_pairs()
            .find(|(k, _)| k == "state")
            .map(|(_, v)| v.to_string());
        let error = parsed
            .query_pairs()
            .find(|(k, _)| k == "error")
            .map(|(_, v)| v.to_string());
        let _ = debug_log::append(
            app,
            "protocol",
            &format!(
                "parsed token_present={} state_present={} error_present={}",
                token.is_some(),
                state.is_some(),
                error.is_some()
            ),
        );
        auth::process_oauth_callback(app, token, state, error);
    } else {
        let _ = debug_log::append(app, "protocol", "failed to parse protocol URL");
    }
}
