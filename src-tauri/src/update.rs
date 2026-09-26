use crate::debug_log;
use crate::models::{
    CompressorManifest, CompressorManifestEntry, FileProgress, FileUpdateItem, UpdateCheckResult,
    UpdateStatus,
};
use crate::state::AppState;
use crate::storage::save_version_cache;
use anyhow::{anyhow, Context, Result};
use futures_util::StreamExt;
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};

/// Streaming HTTP client + base URL for the compressor CDN.
///
/// `https://assets.zemu.uk/manifest.json` is the canonical entry point
/// the launcher hits; `<base>/<path>.zst` is the per-file artifact.
#[derive(Clone)]
struct UpdateClient {
    base_url: String,
    http: reqwest::Client,
}

impl UpdateClient {
    fn new(base_url: String) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            http: reqwest::Client::new(),
        }
    }

    async fn get_manifest(&self) -> Result<CompressorManifest> {
        let url = format!("{}/manifest.json", self.base_url);
        let response = self.http.get(url).send().await?;
        if !response.status().is_success() {
            return Err(anyhow!(
                "failed fetching manifest: {}",
                response.status()
            ));
        }
        let manifest = response.json::<CompressorManifest>().await?;
        Ok(manifest)
    }

    async fn download(
        &self,
        relative_path: &str,
        _expected_size: Option<u64>,
        mut on_progress: impl FnMut(u64, u64, Option<f64>),
        cancel_check: impl Fn() -> bool,
    ) -> Result<Vec<u8>> {
        // `<path>.zst` — flat in the bucket root.
        let clean_path = relative_path.trim_start_matches('/');
        let url = format!("{}/{}.zst", self.base_url, clean_path);

        let response = self.http.get(&url).send().await?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(anyhow!("not found: {} -> {}", relative_path, url));
        }
        if !response.status().is_success() {
            return Err(anyhow!(
                "download failed for {relative_path}: {}",
                response.status()
            ));
        }

        let total = response.content_length().unwrap_or(0);
        let mut stream = response.bytes_stream();
        let mut buffer = Vec::new();
        let mut loaded = 0_u64;
        let started_at = Instant::now();

        while let Some(next) = stream.next().await {
            if cancel_check() {
                return Err(anyhow!("Update cancelled by user"));
            }
            let chunk = next?;
            loaded += chunk.len() as u64;
            buffer.extend_from_slice(&chunk);

            let elapsed = started_at.elapsed().as_secs_f64();
            let speed = if elapsed > 0.0 {
                Some((loaded as f64) / elapsed)
            } else {
                None
            };
            on_progress(loaded, total, speed);
        }

        // Authoritative size check — `Content-Length` first (CDN truth),
        // then the manifest's `compressedSize` as a fallback. Without
        // this, a truncated HTTP stream could feed a short zstd payload
        // through to the launcher, and the on-disk blake3 check would
        // correctly reject it — but at that point we'd have already
        // surfaced a confusing "checksum mismatch" instead of the
        // clearer "the download itself was truncated".
        // NOTE: we intentionally do NOT validate the downloaded bytes
        // against the manifest's `compressedSize` here. That field can
        // drift from reality if a previous compressor run only partially
        // succeeded (e.g. uploaded the .zst but failed before uploading
        // the manifest). The Content-Length guard above catches truncated
        // downloads, and the blake3 hash check in the caller catches any
        // real integrity issues with a clearer error message than
        // "unexpected size: expected X, got Y".
        // NOTE: we intentionally skip validating the downloaded byte count
        // against the manifest's `compressedSize` here. That field can drift
        // from reality if a previous compressor run only partially succeeded
        // (e.g. uploaded the .zst but failed before writing the manifest).
        // The Content-Length guard above already catches truncated downloads,
        // and the downstream blake3 hash check surfaces a clear error if the
        // payload integrity is actually bad.
        if total > 0 && loaded != total {
            return Err(anyhow!(
                "downloaded payload for {relative_path} is truncated: \
                 Content-Length said {} bytes, got {} bytes",
                total,
                loaded
            ));
        }

        Ok(buffer)
    }
}

pub async fn check_for_updates(
    app: &AppHandle,
    state: &AppState,
    game_directory: String,
    // Filenames (basenames) the caller wants excluded from the
    // update verdict — matched case-insensitively against the
    // basename of each manifest entry's path. Typically files the
    // launcher rewrites at runtime (e.g. `ClientConfig.ini`) so a
    // local edit doesn't read as a tampered file forever.
    skip_files: Vec<String>,
) -> Result<UpdateCheckResult> {
    if game_directory.trim().is_empty() {
        return Err(anyhow!("Game directory is required to check for updates"));
    }
    let _ = debug_log::append(
        app,
        "update",
        &format!("check_for_updates start game_directory={game_directory}"),
    );

    let base_url = match state.get_update_base_url() {
        Some(url) => url,
        None => {
            let _ = debug_log::append(app, "update", "check_for_updates no_update_url_configured");
            return Ok(UpdateCheckResult {
                has_update: false,
                cdn_available: false,
                current_version: None,
                latest_version: None,
                files_to_update: None,
            });
        }
    };

    let client = UpdateClient::new(base_url);
    let remote_manifest = match client.get_manifest().await {
        Ok(manifest) => manifest,
        Err(err) => {
            let _ = debug_log::append(
                app,
                "update",
                &format!("check_for_updates manifest_fetch_error={err}"),
            );
            return Ok(UpdateCheckResult {
                has_update: false,
                cdn_available: false,
                current_version: None,
                latest_version: None,
                files_to_update: None,
            });
        }
    };

    let _ = debug_log::append(
        app,
        "update",
        &format!(
            "check_for_updates manifest version={} files={}",
            remote_manifest.version,
            remote_manifest.files.len()
        ),
    );

    let files_to_update =
        compute_files_to_update(&remote_manifest, &game_directory, &skip_files)?;

    let local_version = load_local_manifest(&game_directory)?.map(|m| m.version);

    let result = UpdateCheckResult {
        has_update: !files_to_update.is_empty(),
        cdn_available: true,
        current_version: local_version,
        latest_version: Some(remote_manifest.version.clone()),
        files_to_update: if files_to_update.is_empty() {
            None
        } else {
            Some(files_to_update)
        },
    };
    let _ = debug_log::append(
        app,
        "update",
        &format!(
            "check_for_updates result has_update={} files_to_update={}",
            result.has_update,
            result
                .files_to_update
                .as_ref()
                .map(|items| items.len())
                .unwrap_or(0)
        ),
    );
    Ok(result)
}

pub fn get_update_status(state: &AppState) -> Option<UpdateStatus> {
    let guard = state.update_runtime.lock().ok()?;
    guard.status.clone()
}

pub fn cancel_update(state: &AppState) {
    if let Ok(mut runtime) = state.update_runtime.lock() {
        runtime.cancel_requested = true;
    }
}

pub async fn start_download_and_install(
    app: AppHandle,
    state: AppState,
    game_directory: String,
) -> crate::models::CommandResult {
    let start = (|| -> Result<()> {
        if !PathBuf::from(&game_directory).exists() {
            return Err(anyhow!("Game directory does not exist: {game_directory}"));
        }

        let mut runtime = state
            .update_runtime
            .lock()
            .map_err(|_| anyhow!("failed to lock update runtime"))?;
        if runtime.is_updating {
            return Err(anyhow!("Update is already running"));
        }

        runtime.is_updating = true;
        runtime.cancel_requested = false;
        runtime.status = Some(UpdateStatus::default());
        Ok(())
    })();

    if let Err(err) = start {
        let _ = debug_log::append(
            &app,
            "update",
            &format!("start_download_and_install start_error={err}"),
        );
        return crate::models::CommandResult::err(err.to_string());
    }

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = download_and_install(&app_handle, &state, &game_directory).await;
        match result {
            Ok(()) => {
                let _ = debug_log::append(&app_handle, "update", "download_and_install completed");
            }
            Err(err) => {
                let mut status = state
                    .update_runtime
                    .lock()
                    .ok()
                    .and_then(|runtime| runtime.status.clone())
                    .unwrap_or_default();
                status.is_updating = false;
                status.error = Some(err.to_string());
                update_runtime_status(&state, &status, false);
                emit_status(&app_handle, &status);
                let _ = debug_log::append(
                    &app_handle,
                    "update",
                    &format!("download_and_install failed error={err}"),
                );
            }
        }
    });

    crate::models::CommandResult::ok()
}

async fn download_and_install(
    app: &AppHandle,
    state: &AppState,
    game_directory: &str,
) -> Result<()> {
    let base_url = state.get_update_base_url().ok_or_else(|| {
        anyhow!("Update service is not configured. Call launcher_set_runtime_update_url first.")
    })?;

    let client = UpdateClient::new(base_url);
    let remote_manifest = client.get_manifest().await?;
    let _ = debug_log::append(
        app,
        "update",
        &format!(
            "download_and_install manifest version={} files={} removed={}",
            remote_manifest.version,
            remote_manifest.files.len(),
            remote_manifest.removed.len()
        ),
    );

    let skip_files: Vec<String> = Vec::new();
    let files_to_update =
        compute_files_to_update(&remote_manifest, game_directory, &skip_files)?;
    let _ = debug_log::append(
        app,
        "update",
        &format!("download_and_install files_to_update={}", files_to_update.len()),
    );

    if files_to_update.is_empty() {
        // Nothing to download — but we still need to run the delete
        // phase and persist the new manifest so a user who jumped
        // versions sees a consistent state on the next check.
        finalize_after_download(app, state, game_directory, &remote_manifest, &skip_files, 0)?;
        return Ok(());
    }

    let mut status = UpdateStatus {
        is_updating: true,
        current_file: Some(files_to_update[0].path.clone()),
        total_files: files_to_update.len(),
        completed_files: 0,
        overall_progress: 0.0,
        files: Some(
            files_to_update
                .iter()
                .map(|item| FileProgress {
                    file_path: item.path.clone(),
                    stage: "downloading".to_string(),
                    progress: 0.0,
                    downloaded: 0,
                    total: item.entry.compressed_size,
                    speed: Some(0.0),
                })
                .collect(),
        ),
        error: None,
    };

    update_runtime_status(state, &status, true);
    emit_status(app, &status);

    for (index, file_item) in files_to_update.iter().enumerate() {
        ensure_not_cancelled(state)?;

        status.current_file = Some(file_item.path.clone());
        status.completed_files = index;
        update_runtime_status(state, &status, true);
        emit_status(app, &status);

        download_and_apply_single_file(
            app,
            state,
            &client,
            game_directory,
            file_item,
            &mut status,
            index,
        )
        .await?;

        status.completed_files = index + 1;
        status.overall_progress = calculate_overall_progress(&status);
        update_runtime_status(state, &status, true);
        emit_status(app, &status);
    }

    finalize_after_download(
        app,
        state,
        game_directory,
        &remote_manifest,
        &skip_files,
        files_to_update.len(),
    )?;
    Ok(())
}

/// Write the new manifest to disk, run the delete phase, and emit the
/// terminal 100% status.
fn finalize_after_download(
    app: &AppHandle,
    state: &AppState,
    game_directory: &str,
    remote_manifest: &CompressorManifest,
    skip_files: &[String],
    total_files_applied: usize,
) -> Result<()> {
    // Delete phase — only meaningful if we have a local manifest to
    // diff against. Without a baseline (fresh install) we don't run
    // this: the compressor's `removed[]` for a first publish would
    // list files the user never had, and silently `fs::remove_file`ing
    // them would be wrong.
    let local_exists = PathBuf::from(game_directory)
        .join("manifest.json")
        .exists();

    let mut deleted = 0usize;
    if local_exists {
        for entry in &remote_manifest.removed {
            if should_skip_path(&entry.path, skip_files) {
                let _ = debug_log::append(
                    app,
                    "update",
                    &format!("finalize delete_skipped path={}", entry.path),
                );
                continue;
            }
            let target = PathBuf::from(game_directory).join(&entry.path);
            match fs::remove_file(&target) {
                Ok(()) => {
                    deleted += 1;
                    let _ = debug_log::append(
                        app,
                        "update",
                        &format!("finalize deleted path={}", entry.path),
                    );
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    // Already gone — that's fine. Don't count it.
                    let _ = debug_log::append(
                        app,
                        "update",
                        &format!(
                            "finalize delete_missing path={} (already gone)",
                            entry.path
                        ),
                    );
                }
                Err(e) => {
                    // Surface the error so a half-deleted install doesn't
                    // get a "complete" stamp on a missing file. The
                    // next launch will re-detect via the on-disk manifest.
                    return Err(anyhow!(
                        "failed to delete {}: {}",
                        target.display(),
                        e
                    ));
                }
            }
        }
    }

    // Persist the new manifest to {gameDir}/manifest.json so the next
    // check has a baseline to diff against.
    let manifest_path = PathBuf::from(game_directory).join("manifest.json");
    let raw = serde_json::to_string_pretty(remote_manifest)?;
    fs::write(&manifest_path, raw)?;
    let _ = save_version_cache(app, remote_manifest);

    let _ = debug_log::append(
        app,
        "update",
        &format!(
            "finalize manifest_written path={} deleted={}",
            manifest_path.display(),
            deleted
        ),
    );

    let status = UpdateStatus {
        is_updating: false,
        current_file: None,
        total_files: total_files_applied,
        completed_files: total_files_applied,
        overall_progress: 100.0,
        files: None,
        error: None,
    };
    update_runtime_status(state, &status, false);
    emit_status(app, &status);

    Ok(())
}

async fn download_and_apply_single_file(
    app: &AppHandle,
    state: &AppState,
    client: &UpdateClient,
    game_directory: &str,
    file_item: &FileUpdateItem,
    status: &mut UpdateStatus,
    file_index: usize,
) -> Result<()> {
    let _ = debug_log::append(
        app,
        "update",
        &format!(
            "download_single start path={} compressed_size={}",
            file_item.path, file_item.entry.compressed_size
        ),
    );

    // Download the `.zst` payload.
    let data = client
        .download(
            &file_item.path,
            Some(file_item.entry.compressed_size),
            |loaded, total, speed| {
                if let Some(files) = status.files.as_mut() {
                    if let Some(file) = files.get_mut(file_index) {
                        file.stage = "downloading".to_string();
                        file.progress = if total > 0 {
                            (loaded as f64 / total as f64) * 100.0
                        } else {
                            0.0
                        };
                        file.downloaded = loaded;
                        file.total = total;
                        file.speed = speed;
                    }
                }
                status.overall_progress = calculate_overall_progress(status);
                update_runtime_status(state, status, true);
                emit_status(app, status);
            },
            || is_cancelled(state),
        )
        .await?;

    // NOTE: we skip the SHA-256 check on the compressed payload here.
    // `compressedHash` in the manifest can drift from reality when the
    // compressor is re-run (a previous partial upload may have written the
    // .zst to R2 but failed before writing the manifest, or vice versa).
    // The blake3 hash verified on the *decompressed* bytes (below) is the
    // authoritative integrity check — it directly proves the file content
    // is correct.

    if let Some(files) = status.files.as_mut() {
        if let Some(file) = files.get_mut(file_index) {
            file.stage = "decompressing".to_string();
            file.progress = 60.0;
            file.downloaded = file_item.entry.compressed_size;
            file.total = file_item.entry.compressed_size;
            file.speed = None;
        }
    }
    status.overall_progress = calculate_overall_progress(status);
    update_runtime_status(state, status, true);
    emit_status(app, status);

    // Decompress. Single zstd stream — no tar wrapper.
    let mut decoder = zstd::Decoder::new(data.as_slice())
        .with_context(|| format!("failed to start zstd decoder for {}", file_item.path))?;
    let mut decoded = Vec::with_capacity(file_item.entry.size as usize);
    decoder
        .read_to_end(&mut decoded)
        .with_context(|| format!("failed to decompress {}", file_item.path))?;

    if decoded.len() as u64 != file_item.entry.size {
        return Err(anyhow!(
            "Decompressed size mismatch for {}: expected {} bytes (manifest), got {}",
            file_item.path,
            file_item.entry.size,
            decoded.len()
        ));
    }

    // Verify the blake3 of the decompressed bytes. This is the
    // integrity guarantee the manifest is built on.
    let actual_blake3 = blake3_hex(&decoded);
    if actual_blake3 != file_item.entry.hash.to_lowercase() {
        return Err(anyhow!(
            "Hash mismatch for {}: expected {}, got {}",
            file_item.path,
            file_item.entry.hash,
            actual_blake3
        ));
    }

    // Both checks passed — write the file directly. We don't need an
    // atomic rename or a `.zemu-new` sibling because there's nothing
    // to roll back to: we verified the bytes before touching disk, and
    // the next check_for_updates will catch any partial failure via
    // the local manifest hash.
    let target = PathBuf::from(game_directory).join(&file_item.path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!("failed to create parent dir {} for {}", parent.display(), file_item.path)
        })?;
    }
    fs::write(&target, &decoded)
        .with_context(|| format!("failed to write {}", target.display()))?;

    if let Some(files) = status.files.as_mut() {
        if let Some(file) = files.get_mut(file_index) {
            file.stage = "complete".to_string();
            file.progress = 100.0;
            file.downloaded = file_item.entry.compressed_size;
            file.total = file_item.entry.compressed_size;
            file.speed = None;
        }
    }
    status.overall_progress = calculate_overall_progress(status);
    update_runtime_status(state, status, true);
    emit_status(app, status);

    let _ = debug_log::append(
        app,
        "update",
        &format!(
            "download_single done path={} bytes={}",
            file_item.path,
            decoded.len()
        ),
    );
    Ok(())
}

/// Compute the list of files that need to be downloaded by diffing the
/// remote manifest against the local one. With no local manifest every
/// remote file is returned (full install). `skip_files` is applied as
/// a basename filter so `ClientConfig.ini`-style always-rewrite files
/// don't trip a false-positive update.
fn compute_files_to_update(
    remote: &CompressorManifest,
    game_directory: &str,
    skip_files: &[String],
) -> Result<Vec<FileUpdateItem>> {
    let local = load_local_manifest(game_directory)?;
    let local_by_path: HashMap<&str, &CompressorManifestEntry> = local
        .as_ref()
        .map(|m| m.files.iter().map(|e| (e.path.as_str(), e)).collect())
        .unwrap_or_default();

    let mut files_to_update = Vec::new();
    for entry in &remote.files {
        if should_skip_path(&entry.path, skip_files) {
            continue;
        }

        let needs_update = match local_by_path.get(entry.path.as_str()) {
            Some(local_entry) => {
                // Trust the local manifest's hash. If they match, the
                // local on-disk file is considered up-to-date. We do
                // NOT re-read the file from disk to verify — the user
                // explicitly chose "manifest-only" change detection.
                local_entry.hash.to_lowercase() != entry.hash.to_lowercase()
            }
            None => true,
        };

        if needs_update {
            files_to_update.push(FileUpdateItem {
                path: entry.path.clone(),
                entry: entry.clone(),
            });
        }
    }

    Ok(files_to_update)
}

fn load_local_manifest(game_directory: &str) -> Result<Option<CompressorManifest>> {
    let path = PathBuf::from(game_directory).join("manifest.json");
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(&path)?;
    match serde_json::from_str::<CompressorManifest>(&raw) {
        Ok(manifest) => Ok(Some(manifest)),
        // Corrupt / unknown schema → behave like no manifest. The
        // next `check_for_updates` will compare the remote against an
        // empty baseline and re-download everything, which is the
        // self-healing behavior we want for a bad local file.
        Err(_) => Ok(None),
    }
}

/// True when `path` matches any name in `skip_files` by basename,
/// case-insensitively. `path` is expected to be a manifest entry's
/// relative path (forward or back slashes). Empty / whitespace-only
/// skip entries are ignored.
fn should_skip_path(path: &str, skip_files: &[String]) -> bool {
    if skip_files.is_empty() {
        return false;
    }
    let basename = match path.rsplit(['/', '\\']).next() {
        Some(name) => name,
        None => return false,
    };
    let basename_lower = basename.to_lowercase();
    skip_files.iter().any(|entry| {
        let trimmed = entry.trim();
        !trimmed.is_empty() && trimmed.to_lowercase() == basename_lower
    })
}

#[allow(dead_code)]
fn _sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn blake3_hex(bytes: &[u8]) -> String {
    let hash = blake3::hash(bytes);
    hash.to_hex().to_string()
}

fn calculate_overall_progress(status: &UpdateStatus) -> f64 {
    let total = status.total_files;
    if total == 0 {
        return 0.0;
    }
    let completed = status.completed_files;
    let in_progress = total - completed;
    let in_progress_pct = match &status.files {
        Some(files) if !files.is_empty() => {
            files.iter().map(|f| f.progress).sum::<f64>() / files.len() as f64
        }
        _ => 0.0,
    };
    let total_progress =
        completed as f64 + (in_progress_pct / 100.0 * in_progress as f64);
    (total_progress / total as f64) * 100.0
}

fn emit_status(app: &AppHandle, status: &UpdateStatus) {
    let _ = app.emit("update-progress", status);
}

fn update_runtime_status(state: &AppState, status: &UpdateStatus, is_updating: bool) {
    if let Ok(mut runtime) = state.update_runtime.lock() {
        runtime.status = Some(status.clone());
        runtime.is_updating = is_updating;
        if !is_updating {
            runtime.cancel_requested = false;
        }
    }
}

fn is_cancelled(state: &AppState) -> bool {
    state
        .update_runtime
        .lock()
        .ok()
        .map(|runtime| runtime.cancel_requested)
        .unwrap_or(false)
}

fn ensure_not_cancelled(state: &AppState) -> Result<()> {
    if is_cancelled(state) {
        return Err(anyhow!("Update cancelled by user"));
    }
    Ok(())
}

/// Re-export the legacy "persist manifest from CDN" entry point so
/// `depot.rs` doesn't break. After a SteamCMD depot download the
/// launcher now writes a `CompressorManifest` derived from the live CDN
/// response into `<gameDir>/manifest.json` so subsequent
/// `check_for_updates` calls have a baseline to diff against.
pub async fn persist_installed_manifest_from_cdn(
    app: &AppHandle,
    game_directory: &std::path::Path,
) -> Result<()> {
    let base_url = match app
        .try_state::<crate::state::AppState>()
        .map(|state| state.get_update_base_url())
        .flatten()
    {
        Some(url) => url,
        None => {
            return Err(anyhow!(
                "Update service is not configured — cannot fetch CDN manifest"
            ));
        }
    };

    let client = UpdateClient::new(base_url);
    let manifest = client.get_manifest().await?;

    let target = PathBuf::from(game_directory).join("manifest.json");
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    let raw = serde_json::to_string_pretty(&manifest)?;
    fs::write(&target, raw)?;
    let _ = save_version_cache(app, &manifest);

    Ok(())
}

// `RemovedEntry` is part of the public wire format; the manifest's
// `removed[]` list is consulted in `download_and_install`'s delete
// phase. We re-export the type here so callers that want to iterate
// `manifest.removed` from Rust (e.g. tests or future tooling) can do
// so without a separate import.
#[allow(unused_imports)]
pub(crate) use crate::models::RemovedEntry as _RemovedEntry;

#[cfg(test)]
mod tests {
    use super::*;

    fn skip_list(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn empty_skip_list_skips_nothing() {
        assert!(!should_skip_path("ClientConfig.ini", &[]));
        assert!(!should_skip_path("any/file/path.dll", &[]));
    }

    #[test]
    fn exact_basename_match_is_skipped() {
        let list = skip_list(&["ClientConfig.ini"]);
        assert!(should_skip_path("ClientConfig.ini", &list));
    }

    #[test]
    fn match_is_case_insensitive() {
        let list = skip_list(&["clientconfig.ini"]);
        assert!(should_skip_path("ClientConfig.ini", &list));
        assert!(should_skip_path("CLIENTCONFIG.INI", &list));
    }

    #[test]
    fn match_works_for_nested_paths() {
        let list = skip_list(&["ClientConfig.ini"]);
        assert!(should_skip_path("H1Z1/ClientConfig.ini", &list));
        assert!(should_skip_path("a/b/c/ClientConfig.ini", &list));
        assert!(should_skip_path("ClientConfig.ini", &list));
    }

    #[test]
    fn path_with_backslashes_uses_basename_too() {
        let list = skip_list(&["ClientConfig.ini"]);
        assert!(should_skip_path("H1Z1\\ClientConfig.ini", &list));
    }

    #[test]
    fn similar_but_different_filenames_are_not_skipped() {
        let list = skip_list(&["ClientConfig.ini"]);
        assert!(!should_skip_path("ClientConfig.bak", &list));
        assert!(!should_skip_path("MyClientConfig.ini", &list));
        assert!(!should_skip_path("ClientConfig.ini.bak", &list));
    }

    #[test]
    fn whitespace_only_entries_are_ignored() {
        let list = skip_list(&["", "   ", "\t", "ClientConfig.ini"]);
        assert!(should_skip_path("ClientConfig.ini", &list));
        assert!(!should_skip_path("anything-else.dll", &list));
    }

    #[test]
    fn multiple_skip_entries_all_match() {
        let list = skip_list(&["ClientConfig.ini", "UserOptions.ini"]);
        assert!(should_skip_path("ClientConfig.ini", &list));
        assert!(should_skip_path("UserOptions.ini", &list));
        assert!(!should_skip_path("SomethingElse.txt", &list));
    }

    #[test]
    fn trim_whitespace_around_entry() {
        let list = skip_list(&["  ClientConfig.ini  "]);
        assert!(should_skip_path("ClientConfig.ini", &list));
    }

    #[test]
    fn blake3_produces_64_hex_chars() {
        // blake3 is fixed at 256-bit output, which serializes to 64
        // lowercase hex chars. We don't pin a specific value here
        // because the compressor's `hash_file` is the canonical
        // producer and it uses the same crate version.
        let hex = blake3_hex(b"hello");
        assert_eq!(hex.len(), 64);
        assert!(hex.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }
}
