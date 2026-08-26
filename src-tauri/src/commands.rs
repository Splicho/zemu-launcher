use crate::api;
use crate::auth;
use crate::debug_log;
use crate::discord;
use crate::game;
use crate::models::{
    AuthToken, CommandResult, GameLaunchState, OAuthCallbackPayload, SteamCredentials,
    SteamLoginResult, UpdateCheckResult, UpdateStatus, VersionManifest,
};
use crate::state::AppState;
use crate::storage;
use crate::steam;
use crate::update;
use tauri::Manager;

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

#[tauri::command]
pub fn game_get_executable(app: tauri::AppHandle) -> Result<String, String> {
    Ok(game::get_game_executable(&app))
}

#[tauri::command]
pub fn game_set_executable(app: tauri::AppHandle, executable: String) -> Result<(), String> {
    game::set_game_executable(&app, executable).map_err(|e| e.to_string())
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
pub fn game_download_depot(
    app: tauri::AppHandle,
    credentials: SteamCredentials,
    manifest_id: String,
    depot_id: String,
    output_path: String,
) -> CommandResult {
    game::download_steam_depot(&app, credentials, manifest_id, depot_id, output_path)
}

#[tauri::command]
pub fn launcher_get_steam_credentials(
    app: tauri::AppHandle,
) -> Result<Option<SteamCredentials>, String> {
    storage::load_steam_credentials(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn launcher_save_steam_credentials(
    app: tauri::AppHandle,
    credentials: SteamCredentials,
) -> Result<(), String> {
    storage::save_steam_credentials(&app, &credentials).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn launcher_clear_steam_credentials(app: tauri::AppHandle) -> Result<(), String> {
    storage::clear_steam_credentials(&app).map_err(|e| e.to_string())
}

/// Attempt to sign in to Steam with a username + password.
///
/// Returns a structured [`SteamLoginResult`] so the renderer can:
///   * Show the Steam Guard code field on `NeedsGuard`
///   * Persist the rotated refresh token on `Authenticated`
///   * Surface a human-readable error on `Error`
#[tauri::command]
pub async fn launcher_steam_login(
    app: tauri::AppHandle,
    username: String,
    password: String,
    guard_code: Option<String>,
) -> SteamLoginResult {
    steam::auth::login_with_credentials(&app, &username, &password, guard_code.as_deref()).await
}

#[tauri::command]
pub fn game_launch(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> CommandResult {
    game::launch_game(&app, state.inner().clone())
}

#[tauri::command]
pub fn game_get_launch_state(state: tauri::State<'_, AppState>) -> GameLaunchState {
    state.inner().game_launch_state()
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
pub fn auth_take_pending_oauth_callback(app: tauri::AppHandle) -> Option<OAuthCallbackPayload> {
    auth::take_pending_oauth_callback(&app)
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

/// Frontend-facing log append. The renderer uses this to mirror console
/// errors / Steam auth traces / etc. into a file under the user's
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

pub fn register_commands(
) -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
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
        game_get_executable,
        game_set_executable,
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
        game_download_depot,
        game_launch,
        game_get_launch_state,
        auth_get_token,
        auth_save_token,
        auth_clear_token,
        auth_generate_oauth_state,
        auth_open_oauth,
        auth_manual_oauth_callback,
        auth_complete_oauth_token,
        auth_take_pending_oauth_callback,
        discord_set_in_launcher,
        discord_set_activity,
        debug_log_write,
        debug_log_path,
        debug_log_read,
        debug_log_clear,
        api_get,
        api_post,
        launcher_get_steam_credentials,
        launcher_save_steam_credentials,
        launcher_clear_steam_credentials,
        launcher_steam_login
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