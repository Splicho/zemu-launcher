use crate::api;
use crate::auth;
use crate::debug_log;
use crate::discord;
use crate::friends;
use crate::friends_debug_log;
use crate::game;
use crate::models::{
    AppTheme, AuthToken, CommandResult, DiscordRpcMode, GameLaunchState,
    OAuthCallbackPayload, SteamcmdResult, UpdateCheckResult, UpdateStatus, VersionManifest,
    WineConfig, WineRuntime,
};
use std::path::PathBuf;
use crate::state::AppState;
use crate::steam;
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

#[tauri::command]
pub fn launcher_updates_enabled() -> bool {
    storage::launcher_updates_enabled()
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
pub fn launcher_set_realtime_url(
    _app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    url: String,
) -> Result<(), String> {
    state.set_realtime_url(url);
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

/// True if both `.zemu-install-v1` and `H1Z1.exe` exist at the
/// directory root. Used by the onboarding wizard's `setup-checks` to
/// detect a previously-completed SteamCMD auto-download and skip
/// Step 3 entirely (don't re-download 15 GB).
#[tauri::command]
pub fn game_detect_base_game_installed(directory: String) -> Result<bool, String> {
    storage::detect_base_game_installed(&directory).map_err(|e| e.to_string())
}

/// Cheap path check exposed to the frontend. Used by `setup-checks.ts`
/// to distinguish "empty folder" from "manually-dropped PS3 folder
/// with `H1Z1.exe` at the root".
#[tauri::command]
pub fn game_path_exists(path: String) -> Result<bool, String> {
    storage::path_exists(&path).map_err(|e| e.to_string())
}

/// Always-true: there is no longer any "is the sidecar present?"
/// check. Kept as a function for API stability with the React
/// wizard's probe call.
#[tauri::command]
pub fn steam_bridge_is_available(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(crate::depot::is_available(&app))
}

/// Returns the current Steam auth status. The renderer only ever
/// sees a boolean + the public account name; the refresh token is
/// held in the OS keychain and never crosses an IPC boundary.
#[tauri::command]
pub fn steam_login_status(app: tauri::AppHandle) -> Result<crate::depot::SteamAuthStatus, String> {
    Ok(crate::depot::get_status(&app))
}

/// Spawn the Steam login flow in `login` mode. The bridge emits
/// `steam-qr` / `steam-scanned` / `steam-authed` / `steam-error`
/// events on the AppHandle as the player scans the QR and approves
/// on their phone.
#[tauri::command]
pub fn steam_login_begin(
    app: tauri::AppHandle,
    _state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    crate::depot::login_qr(app).map_err(|e| e.to_string())
}

/// Cooperative cancel for an in-flight Steam login. The download
/// runs to completion on its dedicated thread; the React wizard's
/// "cancel" button flips the UI back to the idle state and ignores
/// further events.
#[tauri::command]
pub fn steam_login_cancel(app: tauri::AppHandle) -> Result<(), String> {
    crate::depot::cancel(&app);
    Ok(())
}

/// Forget the stored refresh token + account name. Called when the
/// bridge reports the token has expired, or when the user clicks
/// "Sign out" in settings.
#[tauri::command]
pub fn steam_logout(app: tauri::AppHandle) -> Result<(), String> {
    crate::depot::logout(&app).map_err(|e| e.to_string())
}

/// Spawn the depot download using the refresh token already
/// stored in the OS keychain. Used when a returning user has
/// previously completed the QR gate — no second scan needed.
///
/// Emits `depot-progress` / `depot-done` / `depot-error` to the
/// wizard while it runs. The returned `SteamcmdResult` is shaped
/// to match what the wizard consumed from the (now-removed)
/// SteamCMD code path.
#[tauri::command]
pub async fn steam_install_depot(
    app: tauri::AppHandle,
    _state: tauri::State<'_, AppState>,
    dest_dir: String,
) -> Result<SteamcmdResult, String> {
    crate::depot::download_depot(app, PathBuf::from(dest_dir))
        .await
        .map_err(|e| e.to_string())
}

/// Scan-and-go: kick off the QR login and the depot download on
/// the same dedicated runtime. The wizard subscribes once to
/// `steam-qr` / `steam-scanned` / `steam-authed` / `depot-progress`
/// / `depot-done` / `depot-error` and the experience feels like
/// "the game starts downloading as soon as I scan the code".
///
/// Returns immediately after spawning the orchestrator thread; the
/// command is intentionally fire-and-forget so the React UI can
/// keep painting the QR while the user opens the Steam mobile app.
#[tauri::command]
pub fn steam_start_install_pipeline(
    app: tauri::AppHandle,
    dest_dir: String,
) -> Result<(), String> {
    crate::depot::start_scan_and_go(app, PathBuf::from(dest_dir))
        .map_err(|e| e.to_string())
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
pub async fn public_api_get(
    app: tauri::AppHandle,
    url: String,
) -> Result<Option<crate::public_api::PublicApiResponse>, String> {
    // Returning None preserves browser fetch on Windows and macOS.
    if !cfg!(target_os = "linux") {
        return Ok(None);
    }
    let result = crate::public_api::get(&url).await;
    let message = match &result {
        Ok(response) => format!("GET {url} status={}", response.status),
        Err(error) => format!("GET {url} error={error}"),
    };
    let _ = debug_log::append(&app, "public-api", &message);
    result.map(Some).map_err(|error| error.to_string())
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

/// Detect the user's Steam installation and return the absolute path
/// of the depot download folder (`<steam_root>/steamapps/content/app_433850/depot_433851/`).
///
/// Returns `None` when no Steam installation can be located. The
/// renderer treats `None` as "no concrete path available" and falls
/// back to the generic `steamapps/content/...` hint without surfacing
/// an error to the user.
///
/// Detection runs entirely locally: registry lookup on Windows, common
/// path probes on every platform. No network or filesystem walk.
#[tauri::command]
pub fn steam_detect_depot_path() -> Option<String> {
    steam::detect_kotk_depot_path()
}

// ---------------------------------------------------------------------------
// Friends IPC surface
//
// Each `friends_*` command is a thin wrapper around
// `friends::dispatch`. The body of `dispatch` is currently a stub that
// returns `ok: false, reason: "not_implemented"` — see the TODO at the
// top of `src-tauri/src/friends.rs`. Once the real game API is wired
// up, none of these wrappers need to change.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn friends_dispatch(
    app: tauri::AppHandle,
    action: String,
    payload: Option<friends::FriendsPayload>,
) -> friends::FriendsActionResult {
    let payload_summary = match &payload {
        Some(p) => format!(
            "(target_id={:?}, query={:?}, display_name={:?})",
            p.target_id, p.query, p.display_name
        ),
        None => String::from("(no payload)"),
    };
    friends_debug_log::write_with_app(&app, "ipc", &format!("dispatch: action={action} {payload_summary}"));

    let result = friends::friends_dispatch(app.clone(), action.clone(), payload).await;

    let ok_str = if result.ok { "ok" } else { "no" };
    let reason = result.reason.as_deref().unwrap_or("-");
    friends_debug_log::write_with_app(
        &app,
        "ipc",
        &format!("dispatch: action={action} -> ok={ok_str} reason={reason}"),
    );
    result
}

#[tauri::command]
pub async fn friends_list(app: tauri::AppHandle) -> friends::FriendsActionResult {
    friends_debug_log::write_with_app(&app, "ipc", "list");
    friends::friends_list(app).await
}

#[tauri::command]
pub async fn friends_search(
    app: tauri::AppHandle,
    query: String,
) -> friends::FriendsActionResult {
    friends_debug_log::write_with_app(&app, "ipc", &format!("search: query={query:?}"));
    friends::friends_search(app, query).await
}

#[tauri::command]
pub async fn friends_request(
    app: tauri::AppHandle,
    target_id: String,
) -> friends::FriendsActionResult {
    friends_debug_log::write_with_app(&app, "ipc", &format!("request: target_id={target_id}"));
    friends::friends_request(app, target_id).await
}

#[tauri::command]
pub async fn friends_accept(
    app: tauri::AppHandle,
    target_id: String,
) -> friends::FriendsActionResult {
    friends_debug_log::write_with_app(&app, "ipc", &format!("accept: target_id={target_id}"));
    friends::friends_accept(app, target_id).await
}

#[tauri::command]
pub async fn friends_decline(
    app: tauri::AppHandle,
    target_id: String,
) -> friends::FriendsActionResult {
    friends_debug_log::write_with_app(&app, "ipc", &format!("decline: target_id={target_id}"));
    friends::friends_decline(app, target_id).await
}

#[tauri::command]
pub async fn friends_cancel(
    app: tauri::AppHandle,
    target_id: String,
) -> friends::FriendsActionResult {
    friends_debug_log::write_with_app(&app, "ipc", &format!("cancel: target_id={target_id}"));
    friends::friends_cancel(app, target_id).await
}

#[tauri::command]
pub async fn friends_remove(
    app: tauri::AppHandle,
    target_id: String,
) -> friends::FriendsActionResult {
    friends_debug_log::write_with_app(&app, "ipc", &format!("remove: target_id={target_id}"));
    friends::friends_remove(app, target_id).await
}

#[tauri::command]
pub async fn friends_save_profile(
    app: tauri::AppHandle,
    display_name: String,
) -> friends::FriendsActionResult {
    friends_debug_log::write_with_app(&app, "ipc", &format!("save_profile: display_name={display_name:?}"));
    friends::friends_save_profile(app, display_name).await
}

// ---------------------------------------------------------------------------
// Friends debug log commands
//
// Mirror of `debug_log_*` so users can read/clear the dedicated
// `friendlist-debug.log` from the front-end (e.g. from a dev tools
// panel) without touching the main `launcher-debug.log`.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn friends_debug_log_path(app: tauri::AppHandle) -> String {
    friends_debug_log::log_path_string(&app)
}

#[tauri::command]
pub fn friends_debug_log_read(app: tauri::AppHandle) -> Result<String, String> {
    friends_debug_log::read(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn friends_debug_log_clear(app: tauri::AppHandle) -> Result<(), String> {
    friends_debug_log::clear(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn friends_debug_log_write(
    app: tauri::AppHandle,
    source: String,
    message: String,
) -> Result<(), String> {
    friends_debug_log::write_with_app(&app, &source, &message);
    Ok(())
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
        launcher_updates_enabled,
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
        launcher_set_realtime_url,
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
        public_api_get,
        api_post,
        launcher_get_autostart_enabled,
        launcher_set_autostart_enabled,
        launcher_get_auth_key,
        launcher_set_auth_key,
        steam_bridge_is_available,
        steam_login_status,
        steam_login_begin,
        steam_login_cancel,
        steam_logout,
        steam_install_depot,
        steam_start_install_pipeline,
        game_detect_base_game_installed,
        game_path_exists,
        steam_detect_depot_path,
        friends_dispatch,
        friends_list,
        friends_search,
        friends_request,
        friends_accept,
        friends_decline,
        friends_cancel,
        friends_remove,
        friends_save_profile,
        friends_debug_log_write,
        friends_debug_log_path,
        friends_debug_log_read,
        friends_debug_log_clear,
        debug_fire_friend_request
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

/// Debug helper: fires the `friends:incoming-request` Tauri event locally so
/// the friend-request toast can be smoke-tested without a running backend or
/// Socket.IO connection.
///
/// Usage in the browser console (or anywhere `invoke` is available):
///   const { invoke } = window.__TAURI__
///   await invoke('debug_fire_friend_request', {
///     displayName: 'TestUser',
///     avatarUrl: null
///   })
///
/// This is only compiled into dev builds (guarded by `cfg(debug_assertions)`
/// in release builds, the function is still declared so `generate_handler!`
/// can list it without splitting the handler table into two `cfg`-gated
/// invocations).
#[cfg_attr(not(debug_assertions), allow(dead_code))]
#[tauri::command]
pub fn debug_fire_friend_request(
    app: tauri::AppHandle,
    display_name: Option<String>,
    avatar_url: Option<String>,
) -> Result<(), String> {
    use tauri::Emitter;

    let resolved_name = display_name
        .clone()
        .unwrap_or_else(|| "Test User".to_string());
    friends_debug_log::write_with_app(
        &app,
        "debug-fire",
        &format!(
            "synthetic incoming-request: display_name={resolved_name:?} avatar_url={avatar_url:?}"
        ),
    );

    let payload = serde_json::json!({
        "fromUser": {
            "id": "debug-user-id",
            "displayName": resolved_name,
            "avatarUrl": avatar_url,
        }
    });
    app.emit("friends:incoming-request", payload)
        .map_err(|e| e.to_string())
}
