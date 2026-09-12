use crate::debug_log;
use crate::discord;
use crate::models::CommandResult;
use crate::session_id;
use crate::state::AppState;
use crate::storage::{
    detect_game_executable, load_launcher_config, load_version_cache, normalize_callback_protocol,
    save_launcher_config,
};
#[cfg(not(target_os = "windows"))]
use crate::wine;
use anyhow::{anyhow, Result};
#[cfg(target_os = "windows")]
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
#[cfg(target_os = "windows")]
use std::thread;
#[cfg(target_os = "windows")]
use std::time::Duration;
use tauri::{AppHandle, Emitter};
#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};

#[cfg(target_os = "windows")]
const GAME_PROCESS_POLL_INTERVAL: Duration = Duration::from_secs(2);
const GAME_LAUNCH_STATE_EVENT: &str = "game-launch-state";
const DEFAULT_GAME_EXECUTABLE: &str = "H1Z1.exe";

pub fn get_game_directory(app: &AppHandle) -> Result<Option<String>> {
    let config = load_launcher_config(app)?;
    Ok(config.game_directory)
}

pub fn set_game_directory(app: &AppHandle, directory: String) -> Result<bool> {
    let mut config = load_launcher_config(app)?;
    config.game_directory = Some(directory);
    save_launcher_config(app, &config)?;
    Ok(true)
}

pub fn clear_game_directory(app: &AppHandle) -> Result<bool> {
    let mut config = load_launcher_config(app)?;
    config.game_directory = None;
    save_launcher_config(app, &config)?;
    Ok(true)
}

/// Sum the byte sizes of every regular file inside `directory`,
/// recursively. Symlinks are followed with `follow_links(false)` to
/// avoid double-counting or loops. Used by the Properties > Installed
/// Files panel to display the on-disk size of whatever the user has
/// dropped into the game folder (base game + our patches + saves).
pub fn get_folder_size_bytes(directory: &str) -> Result<u64> {
    let path = Path::new(directory);
    if !path.exists() {
        return Ok(0);
    }

    let mut total: u64 = 0;
    for entry in walkdir::WalkDir::new(path).follow_links(false) {
        match entry {
            Ok(entry) => {
                if entry.file_type().is_file() {
                    if let Ok(metadata) = entry.metadata() {
                        total = total.saturating_add(metadata.len());
                    }
                }
            }
            Err(error) => {
                // Skip unreadable entries rather than failing the whole
                // walk — one permission-denied file shouldn't black out
                // the size readout. Surface the skip in the dev console
                // so devs can diagnose when sizes look wrong.
                eprintln!("get_folder_size_bytes: skipping entry: {error}");
            }
        }
    }

    Ok(total)
}

/// Open the user's OS file manager pointed at `directory`.
///
/// Goes straight to the platform-native opener rather than
/// `webbrowser::open`, which routes through the user's default browser
/// and opens a `file://` URL in a new tab on Windows.
pub fn open_in_file_manager(directory: &str) -> Result<()> {
    let path = Path::new(directory);
    if !path.exists() {
        return Err(anyhow!("Directory does not exist: {directory}"));
    }

    #[cfg(target_os = "windows")]
    {
        // `explorer.exe` accepts a folder path and opens it directly in
        // File Explorer. `cmd /c start ""` is the conventional incantation
        // for "open with the default handler" but for a folder we want
        // Explorer specifically, so we invoke it directly.
        // Note: `explorer.exe` exits with a non-zero status even on
        // success in some locales, so we ignore the exit code.
        Command::new("explorer.exe")
            .arg(path)
            .spawn()
            .map_err(|error| anyhow!("Failed to launch Explorer: {error}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|error| anyhow!("Failed to launch Finder: {error}"))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|error| anyhow!("Failed to launch xdg-open: {error}"))?;
    }

    Ok(())
}

pub fn get_game_executable(app: &AppHandle) -> String {
    let configured = detect_game_executable(app);
    if configured.is_empty() {
        DEFAULT_GAME_EXECUTABLE.to_string()
    } else {
        configured
    }
}

pub fn set_game_executable(app: &AppHandle, executable: String) -> Result<()> {
    let trimmed = executable.trim().to_string();
    let mut config = load_launcher_config(app)?;
    config.game_executable = if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.clone())
    };
    save_launcher_config(app, &config)?;
    let _ = debug_log::append(
        app,
        "config",
        &format!(
            "set_game_executable value={}",
            config
                .game_executable
                .as_deref()
                .unwrap_or(DEFAULT_GAME_EXECUTABLE)
        ),
    );
    Ok(())
}

pub fn set_update_base_url(app: &AppHandle, url: String) -> Result<()> {
    let mut config = load_launcher_config(app)?;
    let trimmed = url.trim().trim_end_matches('/').to_string();
    config.update_base_url = if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.clone())
    };
    save_launcher_config(app, &config)?;
    let _ = debug_log::append(
        app,
        "config",
        &format!(
            "set_update_base_url value={}",
            config.update_base_url.as_deref().unwrap_or("<none>")
        ),
    );
    Ok(())
}

pub fn set_oauth_callback_protocol(app: &AppHandle, protocol: String) -> Result<()> {
    let mut config = load_launcher_config(app)?;
    let normalized = normalize_callback_protocol(&protocol)
        .ok_or_else(|| anyhow!("Invalid OAuth callback protocol"))?;
    config.oauth_callback_protocol = Some(normalized.clone());
    save_launcher_config(app, &config)?;
    let _ = debug_log::append(
        app,
        "config",
        &format!("set_oauth_callback_protocol value={normalized}"),
    );
    Ok(())
}

pub fn set_api_base_url(app: &AppHandle, url: String) -> Result<()> {
    let mut config = load_launcher_config(app)?;
    let trimmed = url.trim().trim_end_matches('/').to_string();
    config.api_base_url = if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.clone())
    };
    save_launcher_config(app, &config)?;
    let _ = debug_log::append(
        app,
        "config",
        &format!(
            "set_api_base_url value={}",
            config.api_base_url.as_deref().unwrap_or("<none>")
        ),
    );
    Ok(())
}

pub fn select_game_directory(app: &AppHandle) -> Result<Option<String>> {
    let default_dir = dirs::document_dir().unwrap_or_else(|| PathBuf::from("C:\\"));
    let picked = rfd::FileDialog::new()
        .set_title("Select Game Installation Directory")
        .set_directory(default_dir)
        .pick_folder();

    if let Some(path) = picked {
        let selected = path.to_string_lossy().to_string();
        set_game_directory(app, selected.clone())?;
        Ok(Some(selected))
    } else {
        Ok(None)
    }
}

pub fn is_game_installed(app: &AppHandle) -> Result<bool> {
    let directory = match get_game_directory(app)? {
        Some(dir) => dir,
        None => return Ok(false),
    };

    let path = PathBuf::from(directory);
    if !path.exists() || !path.is_dir() {
        return Ok(false);
    }

    Ok(path.join("version.json").exists())
}

pub async fn launch_game(app: &AppHandle, state: AppState) -> CommandResult {
    emit_game_launch_state(app, state.begin_game_launch());

    let game_directory = match get_game_directory(app) {
        Ok(Some(dir)) => dir,
        Ok(None) => {
            let err = anyhow!("No game directory set");
            emit_game_launch_state(app, state.reset_game_launch());
            let _ = debug_log::append(app, "game", &format!("launch_game final_error={err}"));
            return CommandResult::err(err.to_string());
        }
        Err(err) => {
            emit_game_launch_state(app, state.reset_game_launch());
            let _ = debug_log::append(app, "game", &format!("launch_game final_error={err}"));
            return CommandResult::err(err.to_string());
        }
    };
    let _ = debug_log::append(
        app,
        "game",
        &format!("launch_game start game_directory={game_directory}"),
    );

    let result = (|| -> Result<()> {
        let executable_rel = get_game_executable(app);
        let executable_path = resolve_game_executable_path(&game_directory, &executable_rel);

        let _ = debug_log::append(
            app,
            "game",
            &format!(
                "launch_game executable_rel={} resolved={}",
                executable_rel,
                executable_path.display()
            ),
        );

        if !executable_path.exists() {
            let _ = debug_log::append(
                app,
                "game",
                &format!(
                    "launch_game missing_executable path={}",
                    executable_path.display()
                ),
            );
            return Err(anyhow!(
                "Game executable not found: {}\n\nPlease ensure the game is fully installed.",
                executable_path.display()
            ));
        }

        let working_dir = executable_path
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| anyhow!("invalid executable path"))?;

        // Keep the local auth-key flow for native and Wine/Proton launches.
        // Do not start with a stale SessionId if writing the saved key fails.
        let config = load_launcher_config(app)?;
        let auth_key = config
            .auth_key
            .as_deref()
            .filter(|key| !key.trim().is_empty())
            .ok_or_else(|| anyhow!("Auth key required. Save your auth key before launching."))?;
        session_id::write_session_id_to_client_config(&game_directory, auth_key)?;
        let _ = debug_log::append(app, "game", "launch_game auth_key_written=true");

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            const DETACHED_PROCESS: u32 = 0x0000_0008;

            let direct_launch = Command::new(&executable_path)
                .current_dir(&working_dir)
                .creation_flags(DETACHED_PROCESS | CREATE_NO_WINDOW)
                .spawn();

            let pid = match direct_launch {
                Ok(child) => {
                    let _ = debug_log::append(
                        app,
                        "game",
                        &format!(
                            "launch_game direct_spawn_ok path={}",
                            executable_path.display()
                        ),
                    );
                    child.id()
                }
                Err(error) => {
                    let _ = debug_log::append(
                        app,
                        "game",
                        &format!(
                            "launch_game direct_spawn_error code={:?} error={}",
                            error.raw_os_error(),
                            error
                        ),
                    );

                    // `os error 740` means "operation requires elevation".
                    // Fallback to elevated launch while preserving the real client PID.
                    if error.raw_os_error() == Some(740) {
                        let pid = launch_game_elevated(&working_dir, &executable_path).map_err(
                            |shell_error| {
                                anyhow!(
                                    "Failed to launch game (direct and elevated fallback failed): direct={error}; elevated={shell_error}"
                                )
                            },
                        )?;
                        let _ = debug_log::append(
                            app,
                            "game",
                            &format!("launch_game shell_fallback_ok=true pid={pid}"),
                        );
                        pid
                    } else {
                        return Err(anyhow!("Failed to launch game: {error}"));
                    }
                }
            };

            set_in_game_presence(app);
            emit_game_launch_state(app, state.mark_game_running(pid));
            start_game_process_monitor(app.clone(), state.clone(), pid);
        }

        #[cfg(not(target_os = "windows"))]
        {
            let child = if let Some(launch) = wine::build_launch_command(app, &executable_path)? {
                let _ = debug_log::append(
                    app,
                    "game",
                    &format!(
                        "launch_game compatibility_runtime={} program={} env_count={}",
                        launch.label,
                        launch.program.display(),
                        launch.env.len()
                    ),
                );
                let mut command = Command::new(&launch.program);
                command.current_dir(&working_dir).args(&launch.args);
                for (key, value) in launch.env {
                    command.env(key, value);
                }
                command
                    .spawn()
                    .map_err(|e| anyhow!("Failed to launch game through Wine/Proton: {e}"))?
            } else {
                Command::new(&executable_path)
                    .current_dir(&working_dir)
                    .spawn()
                    .map_err(|e| anyhow!("Failed to launch game: {e}"))?
            };

            set_in_game_presence(app);
            emit_game_launch_state(app, state.mark_game_running(child.id()));
        }

        Ok(())
    })();

    match result {
        Ok(_) => CommandResult::ok(),
        Err(e) => {
            emit_game_launch_state(app, state.reset_game_launch());
            let _ = debug_log::append(app, "game", &format!("launch_game final_error={e}"));
            CommandResult::err(e.to_string())
        }
    }
}

pub fn get_local_version(app: &AppHandle) -> Result<Option<crate::models::VersionManifest>> {
    let directory = match get_game_directory(app)? {
        Some(dir) => dir,
        None => return load_version_cache(app),
    };

    let game_version = PathBuf::from(directory).join("version.json");
    if !game_version.exists() {
        return load_version_cache(app);
    }

    match fs::read_to_string(&game_version) {
        Ok(raw) => {
            let manifest: crate::models::VersionManifest = serde_json::from_str(&raw)?;
            Ok(Some(manifest))
        }
        Err(_) => load_version_cache(app),
    }
}

/// Resolves the executable path. Accepts either a bare filename (looked up
/// inside `game_directory`) or a relative/absolute path.
fn resolve_game_executable_path(game_directory: &str, executable_rel: &str) -> PathBuf {
    let candidate = PathBuf::from(executable_rel);
    if candidate.is_absolute() {
        return candidate;
    }

    let direct = PathBuf::from(game_directory).join(&candidate);
    if direct.exists() {
        return direct;
    }

    // Fall back to a case-insensitive lookup in the game directory's root —
    // useful for typos like "h1z1.EXE" vs "H1Z1.exe" on case-sensitive
    // filesystems when the manifest omits a casing convention.
    let root = PathBuf::from(game_directory);
    if let Ok(entries) = fs::read_dir(&root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.eq_ignore_ascii_case(executable_rel))
                .unwrap_or(false)
            {
                return path;
            }
        }
    }

    direct
}

fn set_in_game_presence(app: &AppHandle) {
    if let Err(error) = discord::set_in_game(app) {
        let _ = debug_log::append(
            app,
            "discord",
            &format!("failed to queue in-game activity: {error}"),
        );
    }
}

#[cfg(target_os = "windows")]
fn start_game_process_monitor(app: AppHandle, state: AppState, root_pid: u32) {
    thread::spawn(move || {
        while is_process_tree_running(root_pid) {
            thread::sleep(GAME_PROCESS_POLL_INTERVAL);
        }

        if let Some(snapshot) = state.clear_game_launch_if_pid_matches(root_pid) {
            emit_game_launch_state(&app, snapshot);
            if let Err(error) = discord::set_in_launcher(&app) {
                let _ = debug_log::append(
                    &app,
                    "discord",
                    &format!("failed to restore launcher activity: {error}"),
                );
            }
        }
    });
}

fn emit_game_launch_state(app: &AppHandle, state: crate::models::GameLaunchState) {
    let _ = app.emit(GAME_LAUNCH_STATE_EVENT, state);
}

#[cfg(target_os = "windows")]
fn launch_game_elevated(working_dir: &Path, executable: &Path) -> Result<u32> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let file_path = powershell_escape_single_quoted(&executable.to_string_lossy());
    let dir_path = powershell_escape_single_quoted(&working_dir.to_string_lossy());
    let script = format!(
        "$ErrorActionPreference = 'Stop'; $process = Start-Process -FilePath '{file_path}' -WorkingDirectory '{dir_path}' -Verb RunAs -PassThru; Write-Output $process.Id"
    );

    let output = Command::new("powershell")
        .creation_flags(CREATE_NO_WINDOW)
        .args(["-NoProfile", "-Command", script.as_str()])
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(anyhow!(
            "elevated launch failed{}",
            if detail.is_empty() {
                String::new()
            } else {
                format!(": {detail}")
            }
        ));
    }

    let pid = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .ok_or_else(|| anyhow!("elevated launch did not return a process id"))?
        .parse::<u32>()
        .map_err(|error| anyhow!("invalid elevated launch pid: {error}"))?;

    Ok(pid)
}

#[cfg(target_os = "windows")]
fn powershell_escape_single_quoted(value: &str) -> String {
    value.replace('\'', "''")
}

#[cfg(target_os = "windows")]
fn is_process_tree_running(root_pid: u32) -> bool {
    let processes = snapshot_processes();
    if processes.is_empty() {
        return false;
    }

    let live_pids: HashSet<u32> = processes.keys().copied().collect();
    let mut children_by_parent: HashMap<u32, Vec<u32>> = HashMap::new();
    for (pid, parent_pid) in processes {
        children_by_parent.entry(parent_pid).or_default().push(pid);
    }

    let mut stack = vec![root_pid];
    let mut visited = HashSet::new();
    while let Some(pid) = stack.pop() {
        if !visited.insert(pid) {
            continue;
        }
        if live_pids.contains(&pid) {
            return true;
        }
        if let Some(children) = children_by_parent.get(&pid) {
            stack.extend(children.iter().copied());
        }
    }

    false
}

#[cfg(target_os = "windows")]
fn snapshot_processes() -> HashMap<u32, u32> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return HashMap::new();
    }

    let mut processes = HashMap::new();
    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..unsafe { std::mem::zeroed() }
    };

    let has_entry = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
    if has_entry {
        loop {
            processes.insert(entry.th32ProcessID, entry.th32ParentProcessID);
            if unsafe { Process32NextW(snapshot, &mut entry) } == 0 {
                break;
            }
        }
    }

    unsafe {
        CloseHandle(snapshot);
    }

    processes
}
