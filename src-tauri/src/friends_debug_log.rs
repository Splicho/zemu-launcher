//! Append-only debug log for the friends system, written to
//! `friendlist-debug.log` in the user's AppData directory (same dir
//! as the main `launcher-debug.log`).
//!
//! Why a separate file from `launcher-debug.log`?
//!   1. Friends logs don't pollute the main launcher log, which is
//!      already used by other subsystems (auth, game, steam, …).
//!   2. Power users can share just the friends log when reporting a
//!      friends-specific bug without revealing game/Steam/token data
//!      from the main log.
//!   3. Easy to `tail -f` while reproducing a friends bug.
//!
//! Each line is `[RFC3339 timestamp] [source] message`.
//!
//! Two flavours of write function:
//!   * `write(source, message)` — used everywhere outside of an
//!     `AppHandle`-owned context. Resolves the AppData path via
//!     `tauri::Manager::path()` when an `AppHandle` is available, and
//!     falls back to a sibling of `launcher-debug.log` otherwise.
//!   * `write_with_app(app, source, message)` — same, but takes the
//!     `AppHandle` so the path is guaranteed correct.
//!
//! Writes are best-effort: a failure is recorded on stderr but is
//! never propagated to callers.  None of the friends code paths
//! care if a debug line didn't make it to disk.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::Manager;

const LOG_FILE_NAME: &str = "friendlist-debug.log";

/// File-level lock — released before any disk I/O.
static LOG_FILE_LOCK: Mutex<()> = Mutex::new(());

/// Resolve the `friendlist-debug.log` path inside the user's AppData
/// directory.  Falls back to a path beside the executable when the
/// AppData resolution fails (e.g. before the runtime is initialized).
pub fn resolve_log_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(LOG_FILE_NAME))
        .unwrap_or_else(|_| {
            // Fallback: `%LOCALAPPDATA%\com.zemuuk.launcher\friendlist-debug.log`.
            // Matches the app data dir on Windows without requiring tauri's
            // runtime to be ready.
            std::env::var("LOCALAPPDATA")
                .map(|dir| {
                    PathBuf::from(dir)
                        .join("com.zemuuk.launcher")
                        .join(LOG_FILE_NAME)
                })
                .unwrap_or_else(|_| PathBuf::from(LOG_FILE_NAME))
        })
}

/// String form of `resolve_log_path`, for Tauri commands that return
/// the log location to the renderer.
pub fn log_path_string(app: &tauri::AppHandle) -> String {
    resolve_log_path(app).to_string_lossy().to_string()
}

/// Append a single line to `friendlist-debug.log`.
///
/// The `app` argument supplies the AppData path.  Pass `&app` from any
/// `#[tauri::command]`-driven function.  Write failures are swallowed
/// and reported on stderr only.
pub fn write_with_app(app: &tauri::AppHandle, source: &str, message: &str) {
    let path = resolve_log_path(app);
    write_to_path(&path, source, message);
}

/// Plain write helper — used in non-`AppHandle` contexts (e.g. the
/// Socket.IO event handler in `friends_realtime.rs`).
///
/// Path resolution tries the `LOCALAPPDATA` env var first; if that's
/// missing or unwritable, falls back to `<cwd>/friendlist-debug.log`.
pub fn write(source: &str, message: &str) {
    let path = std::env::var("LOCALAPPDATA")
        .map(|dir| PathBuf::from(dir).join("com.zemuuk.launcher").join(LOG_FILE_NAME))
        .unwrap_or_else(|_| PathBuf::from(LOG_FILE_NAME));
    write_to_path(&path, source, message);
}

fn write_to_path(path: &PathBuf, source: &str, message: &str) {
    let _guard = match LOG_FILE_LOCK.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };

    let line = format!(
        "[{}] [{}] {}\n",
        chrono::Utc::now().to_rfc3339(),
        source,
        sanitize(message),
    );

    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    match OpenOptions::new().create(true).append(true).open(path) {
        Ok(mut file) => {
            if let Err(err) = file.write_all(line.as_bytes()) {
                eprintln!("[friends_debug_log] write_all failed for {}: {err}", path.display());
            }
        }
        Err(err) => {
            eprintln!("[friends_debug_log] open failed for {}: {err}", path.display());
        }
    }
}

/// Synchronous full-file read.  Returns `Ok(String)` even when the
/// file doesn't exist (returns empty string).
pub fn read(app: &tauri::AppHandle) -> std::io::Result<String> {
    let _guard = match LOG_FILE_LOCK.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };

    let path = resolve_log_path(app);
    if !path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&path)
}

/// Delete the log file.  Idempotent — succeeds even if the file is
/// already absent.
pub fn clear(app: &tauri::AppHandle) -> std::io::Result<()> {
    let _guard = match LOG_FILE_LOCK.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };

    let path = resolve_log_path(app);
    if path.exists() {
        std::fs::remove_file(&path)?;
    }
    Ok(())
}

fn sanitize(input: &str) -> String {
    input.replace(['\r', '\n'], " ")
}
