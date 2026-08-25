use anyhow::{Context, Result};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::AppHandle;

const LOG_FILE_NAME: &str = "launcher-debug.log";
// `Mutex<()>` is fine here — debug log writes are infrequent and the lock
// is released before any disk I/O happens.
static LOG_FILE_LOCK: Mutex<()> = Mutex::new(());

/// Project-root log path.
///
/// Writes the launcher debug log into the repo root as
/// `launcher-debug.log` so it's easy to find while iterating. Resolved via
/// `CARGO_MANIFEST_DIR` (which always points at `src-tauri/`) so it works
/// regardless of the process CWD.
///
/// `*.log` is gitignored, so this file will never be committed.
fn project_root_log_path() -> Result<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .ok_or_else(|| anyhow::anyhow!("CARGO_MANIFEST_DIR has no parent"))?;
    Ok(repo_root.join(LOG_FILE_NAME))
}

pub fn log_path_string(_app: &AppHandle) -> String {
    project_root_log_path()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "<unavailable>".to_string())
}

pub fn append(_app: &AppHandle, source: &str, message: &str) -> Result<()> {
    let _guard = LOG_FILE_LOCK.lock().ok();
    let path = match project_root_log_path() {
        Ok(p) => p,
        Err(err) => {
            eprintln!("[debug_log] project_root_log_path failed: {err}");
            return Err(err);
        }
    };
    let timestamp = chrono::Utc::now().to_rfc3339();
    let line = format!("[{}] [{}] {}\n", timestamp, source, sanitize_line(message));
    match OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        Ok(mut file) => {
            if let Err(err) = file.write_all(line.as_bytes()) {
                eprintln!("[debug_log] write_all failed for {}: {err}", path.display());
                return Err(anyhow::anyhow!(err));
            }
        }
        Err(err) => {
            eprintln!(
                "[debug_log] open failed for {}: {err}",
                path.display()
            );
            return Err(anyhow::anyhow!(err));
        }
    }
    Ok(())
}

pub fn clear(_app: &AppHandle) -> Result<()> {
    let _guard = LOG_FILE_LOCK.lock().ok();
    let path = project_root_log_path()?;
    if path.exists() {
        std::fs::remove_file(&path)
            .with_context(|| format!("failed removing log file {}", path.display()))?;
    }
    Ok(())
}

pub fn read(_app: &AppHandle) -> Result<String> {
    let _guard = LOG_FILE_LOCK.lock().ok();
    let path = project_root_log_path()?;
    if !path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&path)
        .with_context(|| format!("failed reading log file {}", path.display()))
}

fn sanitize_line(input: &str) -> String {
    input.replace(['\r', '\n'], " ")
}
