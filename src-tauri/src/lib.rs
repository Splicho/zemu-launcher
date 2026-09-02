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
            // so we control the URL handed to the webview.
            //
            // URL strategy:
            //
            //   * `tauri dev` — point both windows at the Vite dev server
            //     defined by `build.devUrl` in `tauri.conf.json`
            //     (typically `http://localhost:5173`).
            //
            //   * release builds — use `WebviewUrl::App("index.html")`,
            //     which goes through Tauri's in-process asset protocol
            //     handler and is webview-agnostic.
            //
            // Why not the obvious "http://tauri.localhost/index.html"
            // form? That host is a Tauri-runtime convention: WebView2
            // (Windows) and WKWebView (macOS) rewrite it to the asset
            // protocol automatically. **WebKitGTK (Linux) does not.**
            // On Linux, that URL is sent out as a real HTTP request to
            // `127.0.0.1:80`, where anything bound (commonly nginx,
            // serving its "Welcome to nginx!" default page) answers and
            // the React app never loads. `WebviewUrl::App` bypasses the
            // magic host and routes directly to the asset handler on
            // every backend.
            let bootstrap_url = build_index_url(app.config().build.dev_url.as_ref())?;
            let main_url = bootstrap_url.clone();

            // Bootstrap window: 460x430, frameless, always on top.
            // The React tree draws the rounded card; the OS window is
            // the surrounding layer.
            //
            // On Windows and macOS we set `transparent(true)` so the
            // React tree's `bg-transparent` outer div lets the desktop
            // show through, leaving only the rounded card visible.
            // Wry implements that via a `softbuffer` composite layer
            // (see `tauri-runtime-wry-2.11.4/src/lib.rs:4700`).
            //
            // On Linux WebKitGTK there is no equivalent layer — wry
            // skips the softbuffer path on this platform (the
            // `is_window_transparent` branch in wry is `#[cfg(windows)]`).
            // Passing `transparent(true)` there asks GTK to create an
            // alpha-transparent surface that WebKitGTK then renders an
            // opaque `bg-background` card on top of, and the surround
            // shows as solid black (because no compositor-level alpha
            // is available). We drop `transparent(true)` on Linux and
            // rely on WebKitGTK's default opaque surface; the bootstrap
            // card's own `bg-background` colour paints the surround.
            //
            // `decorations(false)` and `shadow(false)` stay enabled on
            // every platform — they don't require a transparency
            // pipeline and produce the intended frameless look on
            // Linux, where the surround simply shows as opaque white
            // (or whatever the dark-mode `bg-background` resolves to).
            //
            // `transparent(true)` MUST be set on the builder because
            // we construct the window ourselves with `create: false`
            // in tauri.conf.json — the config's `transparent` field
            // is only honored when Tauri auto-creates the window.
            #[allow(unused_mut)]
            let mut bootstrap_builder = WebviewWindowBuilder::new(app, "bootstrap", bootstrap_url)
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
                .center()
                .visible(true);
            #[cfg(not(target_os = "linux"))]
            {
                bootstrap_builder = bootstrap_builder.transparent(true);
            }
            bootstrap_builder.build()?;
            app_state.mark_bootstrap_active();

            // Main window: 1280x800, frameless. The React tree draws
            // the rounded wrapper + close/minimize buttons. Same
            // transparency caveat as the bootstrap window above.
            #[allow(unused_mut)]
            let mut main_builder = WebviewWindowBuilder::new(app, "main", main_url)
                .title("ZEmu Launcher")
                .inner_size(1280.0, 800.0)
                .resizable(false)
                .maximizable(false)
                .minimizable(true)
                .closable(true)
                .decorations(false)
                .shadow(false)
                .center()
                .visible(false);
            #[cfg(not(target_os = "linux"))]
            {
                main_builder = main_builder.transparent(true);
            }
            main_builder.build()?;

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

/// Build the `WebviewUrl` both windows should load.
///
/// In `tauri dev`, `tauri.conf.json`'s `build.devUrl` is `Some(...)`
/// (e.g. `http://localhost:5173`) and we point straight at the Vite
/// dev server. In a release build, `devUrl` is `None` and we use
/// `WebviewUrl::App("index.html")`, which routes through Tauri's
/// in-process asset protocol handler — webview-agnostic, works on
/// WebView2, WKWebView, and WebKitGTK alike.
fn build_index_url(dev_url: Option<&url::Url>) -> tauri::Result<WebviewUrl> {
    #[cfg(dev)]
    {
        let base = dev_url
            .ok_or_else(|| {
                tauri::Error::Anyhow(anyhow::anyhow!(
                    "tauri.conf.json must define build.devUrl in dev builds"
                ))
            })?
            .to_string();
        let url = if base.ends_with('/') {
            format!("{base}index.html")
        } else {
            format!("{base}/index.html")
        };
        let parsed = Url::parse(&url).map_err(|e| {
            tauri::Error::Anyhow(anyhow::anyhow!("invalid index url {url:?}: {e}"))
        })?;
        return Ok(WebviewUrl::External(parsed));
    }

    #[cfg(not(dev))]
    {
        let _ = dev_url;
        Ok(WebviewUrl::App("index.html".into()))
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