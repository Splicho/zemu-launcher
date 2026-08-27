mod api;
mod auth;
mod commands;
mod debug_log;
mod discord;
mod game;
mod models;
mod oauth_server;
mod pc_identifier;
mod state;
mod storage;
mod update;

use state::AppState;
use tauri::{WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::MacosLauncher;
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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .manage(app_state.clone())
        .invoke_handler(commands::register_commands())
        .setup(move |app| {
            // Both windows load the same `index.html` and route via
            // `getCurrentWindow().label` inside `App.tsx`. We construct
            // them explicitly (with `create: false` in `tauri.conf.json`)
            // so we control the URL handed to WebView2.
            //
            // `WebviewUrl::External` is used instead of `WebviewUrl::App`
            // because Tauri 2's URL resolver strips the `index.html`
            // segment from `WebviewUrl::App("index.html")`, leaving the
            // webview at the asset-protocol origin with no document.
            // `tauri.localhost` is rewritten by WebView2 to the bundled
            // asset handler in production, so it serves `dist/index.html`
            // verbatim.
            let index_url = resolve_index_url(app.config().build.dev_url.as_ref())?;
            let parsed_index = Url::parse(&index_url)
                .map_err(|e| format!("invalid index url {index_url:?}: {e}"))?;

            // Bootstrap window: 460x430, frameless, transparent, always
            // on top. The React tree draws the rounded card; the OS
            // window is the surrounding (transparent) layer.
            //
            // `transparent(true)` MUST be set on the builder because we
            // construct the window ourselves with `create: false` in
            // tauri.conf.json — the config's `transparent` field is
            // only honored when Tauri auto-creates the window.
            WebviewWindowBuilder::new(
                app,
                "bootstrap",
                WebviewUrl::External(parsed_index.clone()),
            )
            .title("ZEmu Launcher")
            .inner_size(460.0, 430.0)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .closable(true)
            .decorations(false)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .transparent(true)
            .center()
            .visible(true)
            .build()?;
            app_state.mark_bootstrap_active();

            // Main window: 1280x800, frameless. The React tree draws
            // the rounded wrapper + close/minimize buttons. The
            // surround is also transparent for visual parity with the
            // bootstrap window.
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(parsed_index))
                .title("ZEmu Launcher")
                .inner_size(1280.0, 800.0)
                .resizable(false)
                .maximizable(false)
                .minimizable(true)
                .closable(true)
                .decorations(false)
                .shadow(false)
                .transparent(true)
                .center()
                .visible(false)
                .build()?;

            discord::initialize(app.handle());
            if let Err(error) = discord::set_in_launcher(app.handle()) {
                eprintln!("[startup] failed to queue initial launcher activity: {error}");
            }

            oauth_server::start_oauth_callback_server(app.handle().clone(), app_state.clone());

            #[cfg(any(target_os = "linux", windows))]
            {
                if let Err(error) = app.deep_link().register_all() {
                    eprintln!("[startup] deep_link register_all failed: {error}");
                }
            }

            let app_handle = app.handle().clone();
            let _ = app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    handle_protocol_url(&app_handle, url.as_str());
                }
            });

            let startup_args: Vec<String> = std::env::args().collect();
            let protocol_prefix = configured_protocol_prefix(app.handle());
            if let Some(url) = startup_args
                .iter()
                .find(|arg| is_oauth_callback_arg(arg, protocol_prefix.as_deref()))
            {
                handle_protocol_url(app.handle(), url);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// The URL WebView2 should load for both windows.
///
/// In `tauri dev`, `tauri.conf.json`'s `build.devUrl` is `Some(...)`
/// (e.g. `http://localhost:5173`) and `tauri.localhost` does not route
/// anywhere, so we point straight at the Vite dev server. In a release
/// build, `devUrl` is `None` and the asset protocol serves
/// `dist/index.html` from `tauri.localhost`, so we use that.
fn resolve_index_url(dev_url: Option<&url::Url>) -> tauri::Result<String> {
    #[cfg(dev)]
    {
        let base = dev_url
            .ok_or_else(|| {
                tauri::Error::Anyhow(anyhow::anyhow!(
                    "tauri.conf.json must define build.devUrl in dev builds"
                ))
            })?
            .to_string();
        return Ok(if base.ends_with('/') {
            format!("{base}index.html")
        } else {
            format!("{base}/index.html")
        });
    }

    #[cfg(not(dev))]
    {
        let _ = dev_url;
        Ok("http://tauri.localhost/index.html".to_string())
    }
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
        auth::process_oauth_callback(app, token, state, error);
    }
}