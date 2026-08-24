use crate::api;
use crate::auth;
use crate::debug_log;
use crate::discord;
use crate::game;
use crate::models::{
    AuthToken, CommandResult, GameLaunchState, OAuthCallbackPayload, UpdateCheckResult,
    UpdateStatus, VersionManifest,
};
use crate::state::AppState;
use crate::storage;
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

#[tauri::command]
pub async fn launcher_finish_bootstrap(app: tauri::AppHandle) -> Result<(), String> {
    let _ = debug_log::append(&app, "bootstrap", "launcher_finish_bootstrap start");
    let main_window = ensure_main_window(&app)?;
    if let Some(state) = app.try_state::<AppState>() {
        state.finish_bootstrap();
    }

    focus_window(&main_window);

    if let Some(window) = app.get_webview_window("bootstrap") {
        let _ = debug_log::append(&app, "bootstrap", "closing bootstrap window");
        window.close().map_err(|e| e.to_string())?;
    }

    let _ = debug_log::append(&app, "bootstrap", "launcher_finish_bootstrap complete");
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
pub fn launcher_set_update_base_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    game::set_update_base_url(&app, url).map_err(|e| e.to_string())
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
    let result = game::select_game_directory(&app).map_err(|e| e.to_string())?;
    let _ = debug_log::append(
        &app,
        "update.command",
        &format!(
            "game_select_directory selected={}",
            result.as_deref().unwrap_or("<none>")
        ),
    );
    Ok(result)
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
pub async fn game_check_update(app: tauri::AppHandle) -> Result<UpdateCheckResult, String> {
    let _ = debug_log::append(&app, "update.command", "game_check_update called");
    let directory = game::get_game_directory(&app)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Game directory is required to check for updates".to_string())?;
    let _ = debug_log::append(
        &app,
        "update.command",
        &format!("game_check_update directory={directory}"),
    );

    match update::check_for_updates(&app, directory).await {
        Ok(result) => {
            let _ = debug_log::append(
                &app,
                "update.command",
                &format!(
                    "game_check_update success has_update={} folder_count={} file_count={}",
                    result.has_update,
                    result
                        .folders_to_update
                        .as_ref()
                        .map(|items| items.len())
                        .unwrap_or(0),
                    result
                        .files_to_update
                        .as_ref()
                        .map(|items| items.len())
                        .unwrap_or(0)
                ),
            );
            Ok(result)
        }
        Err(err) => {
            let _ = debug_log::append(
                &app,
                "update.command",
                &format!("game_check_update error={err}"),
            );
            Err(err.to_string())
        }
    }
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
        api_post
    ]
}

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

    tauri::WebviewWindowBuilder::from_config(app, config)
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())
}

fn focus_window(window: &tauri::WebviewWindow) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}
