use anyhow::{Context, Result};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::AppHandle;
use tauri::Manager;

const LOG_FILE_NAME: &str = "launcher-debug.log";
// `Mutex<()>` is fine here — debug log writes are infrequent and the lock
// is released before any disk I/O happens.
static LOG_FILE_LOCK: Mutex<()> = Mutex::new(());

/// Per-user AppData log path.
///
/// Writes the launcher debug log into the OS-managed app data directory so
/// the log lands somewhere stable on the user's machine both during
/// development and after the bundled installer has placed the .exe under
/// `Program Files`. On Windows this resolves to roughly
/// `%APPDATA%\com.zemuuk.launcher\`; on macOS to `~/Library/Application
/// Support/com.zemuuk.launcher/`; on Linux to `~/.local/share/com.zemuuk.launcher/`.
/// `ensure_dir` is called on every write so the path exists before we try to
/// open the file.
fn appdata_log_path(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| anyhow::anyhow!("app_data_dir unavailable: {e}"))?;
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("failed to create app data dir: {}", dir.display()))?;
    Ok(dir.join(LOG_FILE_NAME))
}

pub fn log_path_string(app: &AppHandle) -> String {
    appdata_log_path(app)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "<unavailable>".to_string())
}

pub fn append(app: &AppHandle, source: &str, message: &str) -> Result<()> {
    let _guard = LOG_FILE_LOCK.lock().ok();
    let path = match appdata_log_path(app) {
        Ok(p) => p,
        Err(err) => {
            eprintln!("[debug_log] appdata_log_path failed: {err}");
            return Err(err);
        }
    };
    let timestamp = chrono::Utc::now().to_rfc3339();
    let line = format!("[{}] [{}] {}\n", timestamp, source, sanitize_line(message));
    match OpenOptions::new().create(true).append(true).open(&path) {
        Ok(mut file) => {
            if let Err(err) = file.write_all(line.as_bytes()) {
                eprintln!("[debug_log] write_all failed for {}: {err}", path.display());
                return Err(anyhow::anyhow!(err));
            }
        }
        Err(err) => {
            eprintln!("[debug_log] open failed for {}: {err}", path.display());
            return Err(anyhow::anyhow!(err));
        }
    }
    Ok(())
}

pub fn clear(app: &AppHandle) -> Result<()> {
    let _guard = LOG_FILE_LOCK.lock().ok();
    let path = appdata_log_path(app)?;
    if path.exists() {
        std::fs::remove_file(&path)
            .with_context(|| format!("failed removing log file {}", path.display()))?;
    }
    Ok(())
}

pub fn read(app: &AppHandle) -> Result<String> {
    let _guard = LOG_FILE_LOCK.lock().ok();
    let path = appdata_log_path(app)?;
    if !path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&path)
        .with_context(|| format!("failed reading log file {}", path.display()))
}

fn sanitize_line(input: &str) -> String {
    input.replace(['\r', '\n'], " ")
}
