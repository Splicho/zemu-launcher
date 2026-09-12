use crate::api;
use crate::auth;
use crate::debug_log;
use crate::discord;
use crate::game;
use crate::models::{
    AppTheme, AuthToken, CommandResult, DiscordRpcMode, GameLaunchState, OAuthCallbackPayload,
    UpdateCheckResult, UpdateStatus, VersionManifest, WineConfig, WineRuntime,
};
use crate::session_id::{self, SessionIdCache};
use crate::state::AppState;
use crate::storage;
use crate::update;
use crate::wine;
use tauri::Manager;
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;

#[tauri::command]
pub fn window_minimize(window: tauri::WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_maximize(window: tauri::WebviewWindow) -> Result<(), String> {
    let is_maximized = window.is_maximized().map_err(|e| e.to_string())?;
    if is_maximized {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn window_restore(window: tauri::WebviewWindow) -> Result<(), String> {
    window.unmaximize().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_close(window: tauri::WebviewWindow) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_is_maximized(window: tauri::WebviewWindow) -> Result<bool, String> {
    window.is_maximized().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn app_is_packaged() -> bool {
    storage::is_packaged()
}

/// Transition from the bootstrap (updater) window to the main launcher
/// window. The main window is created eagerly in `lib.rs` setup so this
/// just unhides, focuses, and closes it.
#[tauri::command]
pub async fn launcher_finish_bootstrap(app: tauri::AppHandle) -> Result<(), String> {
    let main_window = ensure_main_window(&app)?;
    if let Some(state) = app.try_state::<AppState>() {
        state.finish_bootstrap();
    }

    focus_window(&main_window);

    if let Some(window) = app.get_webview_window("bootstrap") {
        window.close().map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn launcher_exit_app(app: tauri::AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        state.finish_bootstrap();
    }
    app.exit(0);
}

#[tauri::command]
pub fn launcher_restart_app(app: tauri::AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        state.finish_bootstrap();
    }
    app.request_restart();
}

#[tauri::command]
pub fn game_get_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    game::get_game_directory(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn game_set_directory(app: tauri::AppHandle, directory: String) -> Result<bool, String> {
    game::set_game_directory(&app, directory).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn game_clear_directory(app: tauri::AppHandle) -> Result<bool, String> {
    game::clear_game_directory(&app).map_err(|e| e.to_string())
}

/// Sum the byte sizes of every regular file inside the user's chosen
/// game folder. Powers the "Installed Files" size readout in the
/// Properties modal. Returns 0 if the folder doesn't exist (so the
/// UI can degrade gracefully during the brief window between clearing
/// the directory and the modal re-rendering).
#[tauri::command]
pub fn game_get_folder_size(directory: String) -> Result<u64, String> {
    game::get_folder_size_bytes(&directory).map_err(|e| e.to_string())
}

/// Open the user's OS file manager pointed at the chosen game folder.
/// Powers the "Locate" action in the Properties > Installed Files
/// section. Dispatches via the `webbrowser` crate, which uses the
/// platform's default handler (ShellExecute on Windows, Finder on
/// macOS, xdg-open on Linux).
#[tauri::command]
pub fn game_open_in_file_manager(directory: String) -> Result<(), String> {
    game::open_in_file_manager(&directory).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn game_get_executable(app: tauri::AppHandle) -> Result<String, String> {
    Ok(game::get_game_executable(&app))
}

#[tauri::command]
pub fn game_set_executable(app: tauri::AppHandle, executable: String) -> Result<(), String> {
    game::set_game_executable(&app, executable).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn wine_get_config(app: tauri::AppHandle) -> Result<WineConfig, String> {
    wine::get_config(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn wine_save_config(app: tauri::AppHandle, config: WineConfig) -> Result<WineConfig, String> {
    wine::save_config(&app, config).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn wine_list_runtimes() -> Vec<WineRuntime> {
    wine::list_runtimes()
}

#[tauri::command]
pub fn wine_select_prefix_directory() -> Result<Option<String>, String> {
    wine::select_prefix_directory().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn wine_select_runtime_executable() -> Result<Option<String>, String> {
    wine::select_runtime_executable().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn launcher_set_update_base_url(_app: tauri::AppHandle, url: String) -> Result<(), String> {
    game::set_update_base_url(&_app, url).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn launcher_set_runtime_update_url(
    _app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    url: String,
) -> Result<(), String> {
    state.set_runtime_update_url(url);
    Ok(())
}

#[tauri::command]
pub fn launcher_set_oauth_callback_protocol(
    app: tauri::AppHandle,
    protocol: String,
) -> Result<(), String> {
    game::set_oauth_callback_protocol(&app, protocol).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn launcher_set_api_base_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    game::set_api_base_url(&app, url).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn game_select_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    game::select_game_directory(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn game_is_installed(app: tauri::AppHandle) -> Result<bool, String> {
    game::is_game_installed(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn game_get_local_version(app: tauri::AppHandle) -> Result<Option<VersionManifest>, String> {
    game::get_local_version(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn game_check_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<UpdateCheckResult, String> {
    let directory = game::get_game_directory(&app)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Game directory is required to check for updates".to_string())?;

    update::check_for_updates(&app, &state, directory)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn game_download_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    game_directory: String,
) -> Result<CommandResult, String> {
    Ok(update::start_download_and_install(app, state.inner().clone(), game_directory).await)
}

#[tauri::command]
pub fn game_get_update_status(state: tauri::State<'_, AppState>) -> Option<UpdateStatus> {
    update::get_update_status(state.inner())
}

#[tauri::command]
pub fn game_cancel_download(state: tauri::State<'_, AppState>) {
    update::cancel_update(state.inner());
}

#[tauri::command]
pub async fn game_launch(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<CommandResult, String> {
    Ok(game::launch_game(&app, state.inner().clone()).await)
}

#[tauri::command]
pub fn game_get_launch_state(state: tauri::State<'_, AppState>) -> GameLaunchState {
    state.inner().game_launch_state()
}

/// Returns the cached session id, if any. Does *not* hit the network —
/// callers wanting a fresh value should call `session_id_refresh`.
///
/// `endpoint` is the resolved URL (config override or default) so the
/// UI can show which server the cached value came from. Masked: never
/// the bearer token.
#[tauri::command]
pub fn session_id_get(app: tauri::AppHandle) -> Result<Option<SessionIdCache>, String> {
    session_id::load_cached_session_id(&app).map_err(|e| e.to_string())
}

/// Force-refresh the session id from the keys endpoint, overwrite the
/// cache, and return the new value. Errors propagate to the renderer
/// so the UI can surface them (toast / banner).
#[tauri::command]
pub async fn session_id_refresh(app: tauri::AppHandle) -> Result<String, String> {
    session_id::get_session_id(&app, true)
        .await
        .map_err(|e| e.to_string())
}

/// Wipe the cached session id. The next `launchGame` will fetch fresh.
#[tauri::command]
pub fn session_id_clear_cache(app: tauri::AppHandle) -> Result<(), String> {
    session_id::clear_cached_session_id(&app).map_err(|e| e.to_string())
}

/// Returns the resolved endpoint config (URL + whether the bearer
/// token is the default or an override). Never returns the bearer
/// token value itself — it's a server-side credential, not a UI asset.
#[tauri::command]
pub fn session_id_get_endpoint(app: tauri::AppHandle) -> serde_json::Value {
    let resolved = session_id::resolve_endpoint(&app);
    let config = storage::load_launcher_config(&app).ok();
    serde_json::json!({
        "url": resolved.url,
        "tokenIsDefault": config
            .as_ref()
            .and_then(|c| c.session_id_bearer_token.as_deref())
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .is_none(),
        "urlIsDefault": config
            .as_ref()
            .and_then(|c| c.session_id_endpoint_url.as_deref())
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .is_none(),
    })
}

#[tauri::command]
pub fn auth_get_token(app: tauri::AppHandle) -> Result<Option<AuthToken>, String> {
    auth::get_token(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn auth_save_token(app: tauri::AppHandle, token: AuthToken) -> Result<(), String> {
    auth::save_token(&app, token).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn auth_clear_token(app: tauri::AppHandle) -> Result<(), String> {
    auth::clear_token(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn auth_generate_oauth_state(
    app: tauri::AppHandle,
    provider: String,
) -> Result<String, String> {
    auth::generate_oauth_state(&app, provider).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn auth_open_oauth(
    app: tauri::AppHandle,
    provider: String,
    is_dev_runtime: bool,
) -> CommandResult {
    auth::open_oauth(&app, provider, is_dev_runtime)
}

#[tauri::command]
pub fn auth_manual_oauth_callback(
    app: tauri::AppHandle,
    token: String,
    state: Option<String>,
) -> CommandResult {
    auth::manual_oauth_callback(&app, token, state)
}

#[tauri::command]
pub async fn auth_complete_oauth_token(
    app: tauri::AppHandle,
    token: String,
    is_dev_runtime: bool,
) -> Result<AuthToken, String> {
    auth::complete_oauth_token(&app, token, is_dev_runtime)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn auth_take_pending_oauth_callback(
    app: tauri::AppHandle,
    expected_state: Option<String>,
) -> Option<OAuthCallbackPayload> {
    auth::take_pending_oauth_callback(&app, expected_state.as_deref())
}

#[tauri::command]
pub fn auth_stop_oauth_callback_server(
    app: tauri::AppHandle,
    expected_state: String,
) -> Result<(), String> {
    crate::oauth_server::stop_oauth_callback_server(&app, &expected_state)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn discord_set_in_launcher(app: tauri::AppHandle) -> Result<(), String> {
    discord::set_in_launcher(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn discord_set_activity(
    app: tauri::AppHandle,
    details: String,
    state: String,
) -> Result<(), String> {
    discord::set_activity(&app, details, state).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn discord_get_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    storage::load_launcher_config(&app)
        .map(|config| config.discord_rpc_enabled)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn discord_set_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mut config = storage::load_launcher_config(&app).map_err(|e| e.to_string())?;
    config.discord_rpc_enabled = enabled;
    storage::save_launcher_config(&app, &config).map_err(|e| e.to_string())?;

    if enabled {
        // Re-apply the current activity so Discord lights up immediately
        // without waiting for the next game-state transition.
        let _ = discord::set_in_launcher(&app);
    }
    Ok(())
}

#[tauri::command]
pub fn discord_get_mode(app: tauri::AppHandle) -> Result<String, String> {
    storage::load_launcher_config(&app)
        .map(|config| match config.discord_rpc_mode {
            DiscordRpcMode::Always => "always".to_owned(),
            DiscordRpcMode::PlayingOnly => "playing_only".to_owned(),
            DiscordRpcMode::Never => "never".to_owned(),
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn discord_set_mode(app: tauri::AppHandle, mode: String) -> Result<(), String> {
    let rpc_mode = match mode.as_str() {
        "always" => DiscordRpcMode::Always,
        "playing_only" => DiscordRpcMode::PlayingOnly,
        "never" => DiscordRpcMode::Never,
        other => return Err(format!("unknown discord_rpc_mode: {other}")),
    };
    let mut config = storage::load_launcher_config(&app).map_err(|e| e.to_string())?;
    config.discord_rpc_mode = rpc_mode;
    storage::save_launcher_config(&app, &config).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn theme_get(app: tauri::AppHandle) -> Result<String, String> {
    storage::load_launcher_config(&app)
        .map(|config| match config.theme {
            AppTheme::System => "system".to_owned(),
            AppTheme::Dark => "dark".to_owned(),
            AppTheme::Light => "light".to_owned(),
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn theme_set(app: tauri::AppHandle, theme: String) -> Result<(), String> {
    let new_theme = match theme.as_str() {
        "system" => AppTheme::System,
        "dark" => AppTheme::Dark,
        "light" => AppTheme::Light,
        other => return Err(format!("unknown theme: {other}")),
    };
    let mut config = storage::load_launcher_config(&app).map_err(|e| e.to_string())?;
    config.theme = new_theme;
    storage::save_launcher_config(&app, &config).map_err(|e| e.to_string())
}

/// Frontend-facing log append. The renderer uses this to mirror console
/// errors / auth traces / etc. into a file under the user's
/// app-data directory so the launcher's `debugLog.read()` command can
/// return them.
#[tauri::command]
pub fn debug_log_write(
    app: tauri::AppHandle,
    source: String,
    message: String,
) -> Result<(), String> {
    debug_log::append(&app, &source, &message).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn debug_log_path(app: tauri::AppHandle) -> String {
    debug_log::log_path_string(&app)
}

#[tauri::command]
pub fn debug_log_read(app: tauri::AppHandle) -> Result<String, String> {
    debug_log::read(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn debug_log_clear(app: tauri::AppHandle) -> Result<(), String> {
    debug_log::clear(&app).map_err(|e| e.to_string())
}

/// Frontend-facing terminal log. Useful while running `pnpm dev`
/// because renderer code normally logs to the WebView console, not to
/// the shell that launched Tauri.
#[tauri::command]
pub fn log_to_terminal(message: String) {
    eprintln!("[renderer] {message}");
}

#[tauri::command]
pub async fn api_get(
    app: tauri::AppHandle,
    path: String,
    query: Option<Vec<(String, String)>>,
) -> Result<serde_json::Value, String> {
    api::api_get(&app, &path, query)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn api_post(
    app: tauri::AppHandle,
    path: String,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    api::api_post(&app, &path, payload)
        .await
        .map_err(|e| e.to_string())
}

/// Returns whether the launcher is currently registered to launch
/// automatically when the user logs in. Mirrors the OS-managed
/// autostart entry (e.g. the Windows Run registry key) — this does
/// not check `LauncherConfig`.
#[tauri::command]
pub fn launcher_get_autostart_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

/// Register or unregister the launcher with the OS autostart mechanism
/// (e.g. `HKCU\...\Run` on Windows). The toggle in Settings writes
/// directly through here so the persisted state always matches what
/// the OS will actually do at logon.
#[tauri::command]
pub fn launcher_set_autostart_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|e| e.to_string())
    } else {
        manager.disable().map_err(|e| e.to_string())
    }
}

/// Returns the currently saved auth key, if any. The value is stored
/// locally in `launcher-config.json` and is never validated against
/// a server — it is passed directly to the game as the session id.
#[tauri::command]
pub fn launcher_get_auth_key(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let config = storage::load_launcher_config(&app).map_err(|e| e.to_string())?;
    Ok(config.auth_key)
}

/// Persist a new auth key, replacing any previously saved value.
/// An empty string clears the key.
#[tauri::command]
pub fn launcher_set_auth_key(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let mut config = storage::load_launcher_config(&app).map_err(|e| e.to_string())?;
    config.auth_key = if key.trim().is_empty() {
        None
    } else {
        Some(key.trim().to_string())
    };
    storage::save_launcher_config(&app, &config).map_err(|e| e.to_string())
}

pub fn register_commands() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static
{
    tauri::generate_handler![
        window_minimize,
        window_maximize,
        window_restore,
        window_close,
        window_is_maximized,
        app_is_packaged,
        launcher_finish_bootstrap,
        launcher_exit_app,
        launcher_restart_app,
        game_get_directory,
        game_set_directory,
        game_clear_directory,
        game_get_folder_size,
        game_open_in_file_manager,
        game_get_executable,
        game_set_executable,
        wine_get_config,
        wine_save_config,
        wine_list_runtimes,
        wine_select_prefix_directory,
        wine_select_runtime_executable,
        launcher_set_update_base_url,
        launcher_set_runtime_update_url,
        launcher_set_oauth_callback_protocol,
        launcher_set_api_base_url,
        game_select_directory,
        game_is_installed,
        game_get_local_version,
        game_check_update,
        game_download_update,
        game_get_update_status,
        game_cancel_download,
        game_launch,
        game_get_launch_state,
        session_id_get,
        session_id_refresh,
        session_id_clear_cache,
        session_id_get_endpoint,
        auth_get_token,
        auth_save_token,
        auth_clear_token,
        auth_generate_oauth_state,
        auth_open_oauth,
        auth_manual_oauth_callback,
        auth_complete_oauth_token,
        auth_take_pending_oauth_callback,
        auth_stop_oauth_callback_server,
        discord_set_in_launcher,
        discord_set_activity,
        discord_get_enabled,
        discord_set_enabled,
        discord_get_mode,
        discord_set_mode,
        theme_get,
        theme_set,
        debug_log_write,
        debug_log_path,
        debug_log_read,
        debug_log_clear,
        log_to_terminal,
        api_get,
        api_post,
        launcher_get_autostart_enabled,
        launcher_set_autostart_enabled,
        launcher_get_auth_key,
        launcher_set_auth_key
    ]
}

/// Bring the launcher to the foreground when a second instance launches.
///
/// The bootstrap (updater) window is preferred while it's active so the
/// user sees the updater status instead of the launcher UI flickering
/// under an in-progress update.
pub fn focus_primary_window(app: &tauri::AppHandle) {
    let bootstrap_active = app
        .try_state::<AppState>()
        .map(|state| state.is_bootstrap_active())
        .unwrap_or(false);

    if bootstrap_active {
        if let Some(window) = app.get_webview_window("bootstrap") {
            focus_window(&window);
            return;
        }
    }

    if let Some(window) = app.get_webview_window("main") {
        focus_window(&window);
    }
}

fn ensure_main_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window("main") {
        return Ok(window);
    }

    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .ok_or_else(|| "Main window configuration not found".to_string())?;

    let builder = tauri::WebviewWindowBuilder::from_config(app, config)
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;
    Ok(builder)
}

fn focus_window(window: &tauri::WebviewWindow) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}
