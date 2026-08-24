use anyhow::{Context, Result};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const LOG_FILE_NAME: &str = "launcher-debug.log";
// `Mutex<()>` is fine here — debug log writes are infrequent and the lock
// is released before any disk I/O happens.
static LOG_FILE_LOCK: Mutex<()> = Mutex::new(());

pub fn log_path(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_log_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    fs_create_dir_all(&dir)
        .with_context(|| format!("failed to create log dir: {}", dir.display()))?;
    Ok(dir.join(LOG_FILE_NAME))
}

pub fn log_path_string(app: &AppHandle) -> String {
    log_path(app)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|_| "<unavailable>".to_string())
}

pub fn append(app: &AppHandle, source: &str, message: &str) -> Result<()> {
    let _guard = LOG_FILE_LOCK.lock().ok();
    let path = log_path(app)?;
    let timestamp = chrono::Utc::now().to_rfc3339();
    let line = format!("[{}] [{}] {}\n", timestamp, source, sanitize_line(message));
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .with_context(|| format!("failed opening log file {}", path.display()))?
        .write_all(line.as_bytes())
        .with_context(|| format!("failed writing log file {}", path.display()))?;
    Ok(())
}

pub fn clear(app: &AppHandle) -> Result<()> {
    let _guard = LOG_FILE_LOCK.lock().ok();
    let path = log_path(app)?;
    if path.exists() {
        std::fs::remove_file(&path)
            .with_context(|| format!("failed removing log file {}", path.display()))?;
    }
    Ok(())
}

pub fn read(app: &AppHandle) -> Result<String> {
    let _guard = LOG_FILE_LOCK.lock().ok();
    let path = log_path(app)?;
    if !path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&path)
        .with_context(|| format!("failed reading log file {}", path.display()))
}

fn sanitize_line(input: &str) -> String {
    input.replace(['\r', '\n'], " ")
}

fn fs_create_dir_all(path: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(path)
}
