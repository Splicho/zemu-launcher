use crate::client_config;
use crate::debug_log;
use crate::discord;
use crate::launch_args;
use crate::models::CommandResult;
use crate::state::AppState;
use crate::storage::{
    detect_game_executable, load_launcher_config, load_version_cache, read_auth_key,
    save_launcher_config,
};
#[cfg(not(target_os = "windows"))]
use crate::wine;
use anyhow::{anyhow, Context, Result};
#[cfg(target_os = "windows")]
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
#[cfg(any(target_os = "windows", target_os = "macos"))]
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
use windows_sys::Win32::System::Threading::{
    OpenProcess, TerminateProcess, PROCESS_TERMINATE,
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
        crate::child_process::command("xdg-open")
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

    // The on-disk "installed" marker is the compressor-format
    // `manifest.json` written by both the depot download and the
    // updater's finalize phase. The earlier `version.json` sentinel
    // is no longer written anywhere in the codebase.
    Ok(path.join("manifest.json").exists())
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

        // Read the local key and pass the same client arguments on every platform.
        // The key lives in the OS keychain (`storage::read_auth_key`); we keep
        // the in-config `auth_key` field as a one-release migration carrier
        // for users whose key was previously written to `launcher-config.json`.
        let auth_key = read_auth_key(app)?
            .filter(|key| !key.trim().is_empty())
            .ok_or_else(|| anyhow!("Auth key required. Save your auth key before launching."))?;
        let config = load_launcher_config(app)?;
        let locale = config.locale.as_deref();
        let client_args = launch_args::client_arguments(&auth_key);

        // Persist the locale into the game's own ClientConfig.ini
        // before spawning. The game reads `[Internationalization]`
        // / `Locale=` from its install directory at startup — that's
        // where it actually picks its in-game language. We do this
        // here (rather than on every setLocale click) so any out-of-
        // band edits to the file aren't fought with by the launcher;
        // `client_config::set_locale` is a no-op if the value is
        // already correct, so this is cheap.
        let client_ini = PathBuf::from(&game_directory).join("ClientConfig.ini");
        client_config::set_locale(&client_ini, locale.unwrap_or(""))
            .context("write ClientConfig.ini locale")?;

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            const DETACHED_PROCESS: u32 = 0x0000_0008;

            let direct_launch = Command::new(&executable_path)
                .args(&client_args)
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
                        let pid = launch_game_elevated(&working_dir, &executable_path, &client_args).map_err(
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
            // `executable_path` is a `PathBuf`; `file_name()` returns
            // `Option<&OsStr>` which `to_string_lossy` flattens.
            let exe_basename = executable_path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| "H1Z1.exe".to_string());
            crate::process_integrity::start_integrity_monitor(
                app.clone(),
                pid,
                exe_basename,
            );
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
                let mut command = crate::child_process::command(&launch.program);
                command
                    .current_dir(&working_dir)
                    .args(&launch.args)
                    .args(&client_args);
                for (key, value) in launch.env {
                    command.env(key, value);
                }
                command
                    .spawn()
                    .map_err(|e| anyhow!("Failed to launch game through Wine/Proton: {e}"))?
            } else {
                crate::child_process::command(&executable_path)
                    .args(&client_args)
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

pub fn get_local_version(app: &AppHandle) -> Result<Option<crate::models::CompressorManifest>> {
    let directory = match get_game_directory(app)? {
        Some(dir) => dir,
        None => return load_version_cache(app),
    };

    // Prefer the new compressor-format manifest.json inside the game
    // directory; fall back to the legacy launcher app-data cache so
    // users who upgraded from a prior launcher build don't see their
    // last-known version wiped.
    let game_manifest = PathBuf::from(&directory).join("manifest.json");
    if game_manifest.exists() {
        match fs::read_to_string(&game_manifest) {
            Ok(raw) => {
                let manifest: crate::models::CompressorManifest = serde_json::from_str(&raw)?;
                return Ok(Some(manifest));
            }
            Err(_) => return load_version_cache(app),
        }
    }

    load_version_cache(app)
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
    // Resolve the configured game exe name once at launch time so we can
    // match any orphans by name on the way out. We capture it here (rather
    // than re-reading config inside the loop) to avoid touching the
    // launcher config from a background thread every poll.
    let target_exe = get_game_executable(&app);
    let target_basename = exe_basename(&target_exe).to_lowercase();

    thread::spawn(move || {
        while is_process_tree_running(root_pid) {
            thread::sleep(GAME_PROCESS_POLL_INTERVAL);
        }

        // The root tree is gone, but H1Z1 sometimes leaves a detached
        // h1z1.exe child behind (e.g. if the user kills the launcher or
        // an anti-cheat relaunches the process out from under us).
        // Sweep and terminate any leftover instances so they don't keep
        // holding sockets, GPU resources, or the wine prefix.
        let killed = kill_processes_by_name(&target_basename);
        if killed > 0 {
            let _ = debug_log::append(
                &app,
                "game",
                &format!(
                    "game_exit_orphan_sweep target={} killed={}",
                    target_basename, killed
                ),
            );
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

#[cfg(target_os = "windows")]
fn kill_processes_by_name(target_basename_lc: &str) -> usize {
    if target_basename_lc.is_empty() {
        return 0;
    }

    let processes = snapshot_processes();
    let mut killed = 0usize;
    for (pid, (_parent, name)) in &processes {
        // Skip ourselves and any process that obviously isn't the game
        // exe. We compare lowercased basenames so case differences
        // (H1Z1.exe vs h1z1.exe) don't matter.
        let name_lc = name.to_lowercase();
        if name_lc != target_basename_lc {
            continue;
        }

        let handle = unsafe { OpenProcess(PROCESS_TERMINATE, 0, *pid) };
        if handle.is_null() {
            // Most likely: process already exited between snapshot and
            // open, or it's protected. Either way, nothing to do.
            continue;
        }
        let terminated = unsafe { TerminateProcess(handle, 1) };
        unsafe { CloseHandle(handle) };
        if terminated != 0 {
            killed += 1;
        }
    }
    killed
}

#[cfg(target_os = "windows")]
fn exe_basename(path: &str) -> String {
    // Manual basename extraction: `Path::new(...).file_name()` is fine on
    // Windows for absolute paths but the configured exe may be a bare
    // name (e.g. "H1Z1.exe") which `file_name` already handles — using
    // our own loop keeps the comparison dependency-free and case-aware
    // for whatever the user typed into the launcher config.
    match path.rfind(|c| c == '\\' || c == '/') {
        Some(idx) => path[idx + 1..].to_string(),
        None => path.to_string(),
    }
}

fn emit_game_launch_state(app: &AppHandle, state: crate::models::GameLaunchState) {
    let _ = app.emit(GAME_LAUNCH_STATE_EVENT, state);
}

#[cfg(target_os = "windows")]
fn launch_game_elevated(
    working_dir: &Path,
    executable: &Path,
    client_args: &[String],
) -> Result<u32> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let file_path = powershell_escape_single_quoted(&executable.to_string_lossy());
    let dir_path = powershell_escape_single_quoted(&working_dir.to_string_lossy());
    let argument_list = launch_args::windows_command_line(client_args);
    let script = format!(
        "$ErrorActionPreference = 'Stop'; $process = Start-Process -FilePath '{file_path}' -WorkingDirectory '{dir_path}' -ArgumentList $env:ZEMU_GAME_ARGS -Verb RunAs -PassThru; Write-Output $process.Id"
    );

    let output = Command::new("powershell")
        .env("ZEMU_GAME_ARGS", argument_list)
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

/// Walk the process tree from `root_pid` and return every
/// `(pid, exe_basename_lc)` pair under it. Used by the process
/// integrity monitor to enumerate loaded modules across any
/// child processes the game spawns (anti-cheats, launchers, etc.).
/// Reuses the same snapshot the orphan-kill sweep reads — the
/// tree walks `parent_pid` edges until exhaustion.
///
/// Returns an empty vec when the root PID has already exited or
/// the snapshot is empty; callers treat both as "monitor done".
#[cfg(target_os = "windows")]
pub(crate) fn collect_process_tree(root_pid: u32) -> Vec<(u32, String)> {
    let processes = snapshot_processes();
    if processes.is_empty() {
        return Vec::new();
    }

    let live_pids: std::collections::HashSet<u32> = processes.keys().copied().collect();
    let mut children_by_parent: HashMap<u32, Vec<u32>> = HashMap::new();
    for (pid, (parent_pid, _)) in &processes {
        children_by_parent.entry(*parent_pid).or_default().push(*pid);
    }

    let mut stack = vec![root_pid];
    let mut visited = HashSet::new();
    let mut out: Vec<(u32, String)> = Vec::new();
    while let Some(pid) = stack.pop() {
        if !visited.insert(pid) {
            continue;
        }
        if !live_pids.contains(&pid) {
            continue;
        }
        if let Some((_, name)) = processes.get(&pid) {
            out.push((pid, name.to_lowercase()));
        }
        if let Some(children) = children_by_parent.get(&pid) {
            stack.extend(children.iter().copied());
        }
    }

    out
}

#[cfg(target_os = "windows")]
fn is_process_tree_running(root_pid: u32) -> bool {
    let processes = snapshot_processes();
    if processes.is_empty() {
        return false;
    }

    let live_pids: HashSet<u32> = processes.keys().copied().collect();
    let mut children_by_parent: HashMap<u32, Vec<u32>> = HashMap::new();
    for (pid, (parent_pid, _)) in &processes {
        children_by_parent.entry(*parent_pid).or_default().push(*pid);
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
pub(crate) fn snapshot_processes() -> HashMap<u32, (u32, String)> {
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
            // `szExeFile` is a wide null-terminated string. Find the
            // first NUL and slice up to it; entries are technically
            // MAX_PATH but the toolhelp API only fills as much as
            // needed plus the terminator.
            let exe_name = wide_null_trim(&entry.szExeFile);
            processes.insert(entry.th32ProcessID, (entry.th32ParentProcessID, exe_name));
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

#[cfg(target_os = "windows")]
pub(crate) fn wide_null_trim(raw: &[u16]) -> String {
    let len = raw.iter().position(|&c| c == 0).unwrap_or(raw.len());
    String::from_utf16_lossy(&raw[..len])
}
