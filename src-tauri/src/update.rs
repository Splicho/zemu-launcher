use crate::debug_log;
use crate::models::{
    CommandResult, FileProgress, FileUpdateItem, FolderManifestEntry, FolderProgress,
    UpdateCheckResult, UpdateStatus, VersionManifest,
};
use crate::state::AppState;
use crate::storage::save_version_cache;
use anyhow::{anyhow, Context, Result};
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

const TEMP_DIR_NAME: &str = "zemu-updates";

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

    async fn get_version_manifest(&self) -> Result<VersionManifest> {
        let url = format!("{}/version.json", self.base_url);
        let response = self.http.get(url).send().await?;
        if !response.status().is_success() {
            return Err(anyhow!(
                "failed fetching version manifest: {}",
                response.status()
            ));
        }

        let manifest = response.json::<VersionManifest>().await?;
        Ok(manifest)
    }

    fn folder_download_path(&self, folder_name: &str, version: &str) -> String {
        format!("{folder_name}-{version}.tar.zst")
    }

    fn file_download_path(&self, file_path: &str) -> String {
        format!("{file_path}.tar.zst")
    }

    async fn download(
        &self,
        relative_path: &str,
        expected_size: Option<u64>,
        mut on_progress: impl FnMut(u64, u64, Option<f64>),
        cancel_check: impl Fn() -> bool,
    ) -> Result<Vec<u8>> {
        let clean_path = relative_path.trim_start_matches('/');
        let url = format!("{}/{}", self.base_url, clean_path);
        eprintln!("[RUST_DEBUG] DOWNLOAD: url={}", url);

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

        // Validate the downloaded stream against whatever authoritative
        // size we have for this artifact. The CDN is the source of
        // truth, so we prefer `Content-Length`. The manifest's
        // `compressed_size` is a second line of defence: if the server
        // omits Content-Length (some static-file hosts do) or sends a
        // wrong value, the manifest can still catch a truncated
        // payload. Without this check, a prematurely-closed HTTP
        // stream would silently feed a truncated `tar.zst` to zstd,
        // which can produce a short extract instead of an error — the
        // decompressed file would then overwrite the on-disk target
        // before the size check at the end of `update_single_file`
        // runs, leaving the launcher stuck on a broken install that
        // reports `has_update=true` forever.
        if let Some(expected) = expected_size {
            if expected > 0 && loaded != expected {
                return Err(anyhow!(
                    "downloaded payload for {relative_path} has unexpected size: \
                     expected {} bytes (manifest), got {} bytes",
                    expected,
                    loaded
                ));
            }
        }
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
                folders_to_update: None,
                files_to_update: None,
                is_file_level: None,
            });
        }
    };
    let _ = debug_log::append(
        app,
        "update",
        &format!("check_for_updates base_url={base_url}"),
    );
    let client = UpdateClient::new(base_url);
    let remote_manifest = match client.get_version_manifest().await {
        Ok(manifest) => manifest,
        Err(err) => {
            let _ = debug_log::append(
                app,
                "update",
                &format!("check_for_updates manifest_fetch_error={err}"),
            );
            // CDN unavailable - return result indicating that
            return Ok(UpdateCheckResult {
                has_update: false,
                cdn_available: false,
                current_version: None,
                latest_version: None,
                folders_to_update: None,
                files_to_update: None,
                is_file_level: None,
            });
        }
    };

    let is_file_level = uses_file_level_manifest(&remote_manifest);
    let local_version = load_local_manifest(&game_directory)?;
    let _ = debug_log::append(
        app,
        "update",
        &format!(
            "check_for_updates manifest version={} build={} folders={} file_level={} local_manifest_present={}",
            remote_manifest.version,
            remote_manifest.build,
            remote_manifest.folders.len(),
            is_file_level,
            local_version.is_some()
        ),
    );

    if local_version.is_none() {
        if is_file_level {
            let _ = debug_log::append(
                app,
                "update",
                "check_for_updates local_manifest_missing=true verify_on_disk=true",
            );

            let files = get_files_to_update(&remote_manifest, None, &game_directory, true)?;

            if files.is_empty() {
                if let Err(error) =
                    persist_installed_manifest(app, &game_directory, &remote_manifest)
                {
                    let _ = debug_log::append(
                        app,
                        "update",
                        &format!(
                            "check_for_updates persist_manifest_on_match_failed error={error}"
                        ),
                    );
                } else {
                    let _ = debug_log::append(
                        app,
                        "update",
                        "check_for_updates persisted_manifest_on_full_match=true",
                    );
                }
            }

            let result = UpdateCheckResult {
                has_update: !files.is_empty(),
                cdn_available: true,
                current_version: None,
                latest_version: Some(remote_manifest.version.clone()),
                folders_to_update: None,
                files_to_update: Some(files),
                is_file_level: Some(true),
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
            return Ok(result);
        }

        let result = UpdateCheckResult {
            has_update: true,
            cdn_available: true,
            current_version: None,
            latest_version: Some(remote_manifest.version.clone()),
            folders_to_update: Some(remote_manifest.folders.keys().cloned().collect()),
            files_to_update: None,
            is_file_level: Some(false),
        };
        let _ = debug_log::append(
            app,
            "update",
            &format!(
                "check_for_updates result has_update={} folders_to_update={}",
                result.has_update,
                result
                    .folders_to_update
                    .as_ref()
                    .map(|items| items.len())
                    .unwrap_or(0)
            ),
        );
        return Ok(result);
    }

    let local_version = local_version.expect("local version checked above");

    if is_file_level {
        let files_to_update = get_files_to_update(
            &remote_manifest,
            Some(&local_version),
            &game_directory,
            false,
        )?;
        let result = UpdateCheckResult {
            has_update: !files_to_update.is_empty(),
            cdn_available: true,
            current_version: Some(local_version.version),
            latest_version: Some(remote_manifest.version.clone()),
            folders_to_update: None,
            files_to_update: Some(files_to_update),
            is_file_level: Some(true),
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
        return Ok(result);
    }

    let version_comparison = compare_versions(&local_version.version, &remote_manifest.version);
    if version_comparison >= 0 {
        let result = UpdateCheckResult {
            has_update: false,
            cdn_available: true,
            current_version: Some(local_version.version),
            latest_version: Some(remote_manifest.version.clone()),
            folders_to_update: None,
            files_to_update: None,
            is_file_level: Some(false),
        };
        let _ = debug_log::append(
            app,
            "update",
            &format!(
                "check_for_updates result has_update=false local_version={} remote_version={}",
                result.current_version.as_deref().unwrap_or(""),
                result.latest_version.as_deref().unwrap_or("")
            ),
        );
        return Ok(result);
    }

    let mut folders_to_update = Vec::new();
    for (folder_name, folder_info) in &remote_manifest.folders {
        let local_folder = local_version.folders.get(folder_name);
        if folder_needs_update(local_folder, folder_info) {
            folders_to_update.push(folder_name.clone());
        }
    }
    let result = UpdateCheckResult {
        has_update: !folders_to_update.is_empty(),
        cdn_available: true,
        current_version: Some(local_version.version),
        latest_version: Some(remote_manifest.version.clone()),
        folders_to_update: Some(folders_to_update),
        files_to_update: None,
        is_file_level: Some(false),
    };
    let _ = debug_log::append(
        app,
        "update",
        &format!(
            "check_for_updates result has_update={} folders_to_update={}",
            result.has_update,
            result
                .folders_to_update
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
) -> CommandResult {
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
        return CommandResult::err(err.to_string());
    }
    let _ = debug_log::append(
        &app,
        "update",
        &format!("start_download_and_install started game_directory={game_directory}"),
    );

    let _ = debug_log::append(
        &app,
        "update",
        &format!(
            "start_download_and_install runtime.lock acquired, is_updating={}",
            {
                let r = state.update_runtime.lock().ok();
                r.map(|g| g.is_updating).unwrap_or(false)
            }
        ),
    );

    let app_handle = app.clone();
    let _ = debug_log::append(
        &app,
        "update",
        "start_download_and_install spawning async task...",
    );
    eprintln!("[RUST_DEBUG] About to spawn async task");
    tauri::async_runtime::spawn(async move {
        eprintln!("[RUST_DEBUG] ASYNC_TASK: started");
        let _ = debug_log::append(&app_handle, "update", "ASYNC_TASK: started");
        let result = download_and_install(&app_handle, &state, &game_directory).await;
        eprintln!("[RUST_DEBUG] ASYNC_TASK: download_and_install returned");
        let _ = debug_log::append(
            &app_handle,
            "update",
            "ASYNC_TASK: download_and_install returned",
        );
        match result {
            Ok(()) => {
                eprintln!("[RUST_DEBUG] ASYNC_TASK: result is Ok, completed");
                let _ = debug_log::append(&app_handle, "update", "download_and_install completed");
            }
            Err(err) => {
                eprintln!("[RUST_DEBUG] ASYNC_TASK: result is Err: {}", err);
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

    CommandResult::ok()
}

async fn download_and_install(
    app: &AppHandle,
    state: &AppState,
    game_directory: &str,
) -> Result<()> {
    let _ = debug_log::append(
        app,
        "update",
        &format!("download_and_install start game_directory={game_directory}"),
    );
    let base_url = state.get_update_base_url().ok_or_else(|| {
        anyhow!("Update service is not configured. Call launcher_set_runtime_update_url first.")
    })?;
    let _ = debug_log::append(
        app,
        "update",
        &format!("download_and_install base_url={base_url}"),
    );
    let client = UpdateClient::new(base_url);
    let _ = debug_log::append(app, "update", "download_and_install fetching manifest...");
    let remote_manifest = client.get_version_manifest().await?;
    let _ = debug_log::append(
        app,
        "update",
        &format!(
            "download_and_install manifest received version={}",
            remote_manifest.version
        ),
    );

    let local_version = load_local_manifest(game_directory)?;
    let is_file_level = uses_file_level_manifest(&remote_manifest);
    let has_folders = !remote_manifest.folders.is_empty();
    let _ = debug_log::append(
        app,
        "update",
        &format!(
            "download_and_install manifest version={} folders={} file_level={} has_folders={} local_manifest_present={}",
            remote_manifest.version,
            remote_manifest.folders.len(),
            is_file_level,
            has_folders,
            local_version.is_some()
        ),
    );

    let temp_dir = std::env::temp_dir().join(TEMP_DIR_NAME);
    fs::create_dir_all(&temp_dir)?;

    // Always load local manifest for checking file needs
    let local_version = load_local_manifest(game_directory)?;

    // PART 1: Download base game files (file-level content)
    //
    // `finalize_total_files` is hoisted so the completion emit at the
    // end of the function can populate `total_files` even when there
    // are no folders to download. The frontend's optimistic flip on
    // 100% progress keys off `totalFolders > 0 || totalFiles > 0`;
    // without it, file-only installs (e.g. a fresh `libcef.dll`
    // download) hit `overall_progress = 100` with both counters at 0,
    // the optimistic flip is skipped, and the launcher stays on
    // "Install Patch" until the user refreshes.
    let mut finalize_total_files: usize = 0;
    if is_file_level {
        let verify_on_disk = local_version.is_none();
        if verify_on_disk {
            let _ = debug_log::append(
                app,
                "update",
                "download_and_install local_manifest_missing=true verify_on_disk=true",
            );
        }
        let files_to_update = get_files_to_update(
            &remote_manifest,
            local_version.as_ref(),
            game_directory,
            verify_on_disk,
        )?;
        let _ = debug_log::append(
            app,
            "update",
            &format!(
                "download_and_install files_to_update={}",
                files_to_update.len()
            ),
        );

        if !files_to_update.is_empty() {
            finalize_total_files = files_to_update.len();
            let mut status = UpdateStatus {
                is_updating: true,
                total_files: files_to_update.len(),
                files: Some(
                    files_to_update
                        .iter()
                        .map(|file| FileProgress {
                            file_path: file.file_path.clone(),
                            stage: "downloading".to_string(),
                            progress: 0.0,
                            downloaded: 0,
                            total: file.entry.compressed_size,
                            speed: Some(0.0),
                        })
                        .collect(),
                ),
                ..UpdateStatus::default()
            };

            update_runtime_status(state, &status, true);
            emit_status(app, &status);

            for (index, file_item) in files_to_update.iter().enumerate() {
                ensure_not_cancelled(state)?;

                status.current_file = Some(file_item.file_path.clone());
                status.completed_files = index;
                update_runtime_status(state, &status, true);
                emit_status(app, &status);

                update_single_file(
                    app,
                    state,
                    &client,
                    game_directory,
                    &temp_dir,
                    &remote_manifest,
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
        }
    }

    // PART 2: Download patches/folders
    let folders_to_update = get_folders_to_update(&remote_manifest, local_version.as_ref());
    let _ = debug_log::append(
        app,
        "update",
        &format!(
            "download_and_install folders_to_update={}",
            folders_to_update.len()
        ),
    );
    if folders_to_update.is_empty() {
        // No folders to update - we're done. Carry the file count
        // forward so the completion emit has `total_files > 0` when
        // PART 1 actually downloaded files; otherwise the frontend's
        // optimistic state flip on `overall_progress === 100` is
        // skipped (it requires either `totalFolders > 0` or
        // `totalFiles > 0`) and the user is stuck on "Install Patch"
        // until they refresh the launcher.
        let status = UpdateStatus {
            is_updating: false,
            overall_progress: 100.0,
            total_files: finalize_total_files,
            completed_files: finalize_total_files,
            ..UpdateStatus::default()
        };
        update_runtime_status(state, &status, false);
        emit_status(app, &status);

        // Persist the freshly-downloaded manifest whenever PART 1
        // applied file-level changes — not only when the local
        // manifest was missing entirely. Without this, the legacy
        // `local_version.is_none()` guard left file-only installs in
        // a permanent "needs update" loop: the next
        // `check_for_updates` loaded the stale `version.json` (with
        // the pre-install file entries), compared the stale local
        // checksum against the now-correct remote checksum, and
        // reported `has_update=true, files_to_update=1` forever —
        // even though the bytes on disk were already correct.
        if finalize_total_files > 0 {
            persist_installed_manifest(app, game_directory, &remote_manifest)?;
        } else if local_version.is_none() {
            // No file-level changes and no folders — keep the prior
            // behavior of back-filling an on-disk manifest when there
            // wasn't one, so subsequent checks have something to read.
            persist_installed_manifest(app, game_directory, &remote_manifest)?;
        }

        let _ = fs::remove_dir_all(&temp_dir);
        return Ok(());
    }

    let mut status = UpdateStatus {
        is_updating: true,
        total_folders: folders_to_update.len(),
        // Carry the file count from PART 1 so the completion emit at
        // the end of this function still reports the work that was
        // already done — without it, the final `overall_progress: 100`
        // status has `total_files: 0` and the frontend's optimistic
        // flip is at the mercy of `total_folders` happening to be > 0.
        total_files: finalize_total_files,
        completed_files: finalize_total_files,
        folders: folders_to_update
            .iter()
            .map(|folder| FolderProgress {
                folder_name: folder.clone(),
                stage: "downloading".to_string(),
                progress: 0.0,
                downloaded: 0,
                total: remote_manifest
                    .folders
                    .get(folder)
                    .and_then(|item| item.compressed_size)
                    .unwrap_or(0),
                speed: Some(0.0),
            })
            .collect(),
        ..UpdateStatus::default()
    };

    update_runtime_status(state, &status, true);
    emit_status(app, &status);

    for (index, folder_name) in folders_to_update.iter().enumerate() {
        ensure_not_cancelled(state)?;

        status.current_folder = Some(folder_name.clone());
        status.completed_folders = index;
        update_runtime_status(state, &status, true);
        emit_status(app, &status);

        update_single_folder(
            app,
            state,
            &client,
            game_directory,
            &temp_dir,
            &remote_manifest,
            folder_name,
            &mut status,
            index,
        )
        .await?;

        status.completed_folders = index + 1;
        status.overall_progress = calculate_overall_progress(&status);
        update_runtime_status(state, &status, true);
        emit_status(app, &status);
    }

    persist_installed_manifest(app, game_directory, &remote_manifest)?;

    status.is_updating = false;
    status.overall_progress = 100.0;
    update_runtime_status(state, &status, false);
    emit_status(app, &status);

    let _ = fs::remove_dir_all(&temp_dir);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn update_single_folder(
    app: &AppHandle,
    state: &AppState,
    client: &UpdateClient,
    game_directory: &str,
    temp_dir: &Path,
    remote_manifest: &VersionManifest,
    folder_name: &str,
    status: &mut UpdateStatus,
    folder_index: usize,
) -> Result<()> {
    let folder_info = remote_manifest
        .folders
        .get(folder_name)
        .ok_or_else(|| anyhow!("Folder not found in manifest: {folder_name}"))?;

    let download_path = client.folder_download_path(folder_name, &remote_manifest.version);
    let _ = debug_log::append(
        app,
        "update",
        &format!("update_single_folder start folder={folder_name} path={download_path}"),
    );
    let temp_file = temp_dir.join(format!("{folder_name}-{}.tar.zst", remote_manifest.version));
    let target_folder = PathBuf::from(game_directory).join(folder_name);

    let data = client
        .download(
            &download_path,
            Some(folder_info.compressed_size.unwrap_or(0)),
            |loaded, total, speed| {
                if let Some(folder) = status.folders.get_mut(folder_index) {
                    folder.stage = "downloading".to_string();
                    folder.progress = if total > 0 {
                        (loaded as f64 / total as f64) * 100.0
                    } else {
                        0.0
                    };
                    folder.downloaded = loaded;
                    folder.total = total;
                    folder.speed = speed;
                }
                status.overall_progress = calculate_overall_progress(status);
                update_runtime_status(state, status, true);
                emit_status(app, status);
            },
            || is_cancelled(state),
        )
        .await?;

    fs::write(&temp_file, &data)?;

    if let Some(expected_checksum) = normalize_checksum_opt(folder_info.checksum.as_deref()) {
        let actual_checksum = calculate_checksum(&data);
        if actual_checksum != expected_checksum {
            return Err(anyhow!("Checksum mismatch for folder {folder_name}"));
        }
    } else {
        let _ = debug_log::append(
            app,
            "update",
            &format!("update_single_folder checksum_missing folder={folder_name}"),
        );
    }

    if let Some(folder) = status.folders.get_mut(folder_index) {
        folder.stage = "decompressing".to_string();
        folder.progress = 60.0;
        let compressed_size = folder_info.compressed_size.unwrap_or(data.len() as u64);
        folder.downloaded = compressed_size;
        folder.total = compressed_size;
        folder.speed = None;
    }
    status.overall_progress = calculate_overall_progress(status);
    update_runtime_status(state, status, true);
    emit_status(app, status);

    extract_archive(app, &temp_file, &target_folder, false)?;

    if let Some(folder) = status.folders.get_mut(folder_index) {
        folder.stage = "complete".to_string();
        folder.progress = 100.0;
        folder.speed = None;
    }
    status.overall_progress = calculate_overall_progress(status);
    update_runtime_status(state, status, true);
    emit_status(app, status);

    let _ = fs::remove_file(temp_file);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn update_single_file(
    app: &AppHandle,
    state: &AppState,
    client: &UpdateClient,
    game_directory: &str,
    temp_dir: &Path,
    _remote_manifest: &VersionManifest,
    file_item: &FileUpdateItem,
    status: &mut UpdateStatus,
    file_index: usize,
) -> Result<()> {
    let download_path = client.file_download_path(&file_item.entry.path);
    let temp_file = temp_dir.join(format!("{}.tar.zst", file_item.file_path.replace('/', "_")));
    let target_file = PathBuf::from(game_directory).join(&file_item.file_path);

    if let Some(parent) = target_file.parent() {
        fs::create_dir_all(parent)?;
    }

    let data = client
        .download(
            &download_path,
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

    fs::write(&temp_file, &data)?;

    if let Some(files) = status.files.as_mut() {
        if let Some(file) = files.get_mut(file_index) {
            file.stage = "decompressing".to_string();
            file.progress = 50.0;
            file.downloaded = file_item.entry.compressed_size;
            file.total = file_item.entry.compressed_size;
            file.speed = None;
        }
    }
    status.overall_progress = calculate_overall_progress(status);
    update_runtime_status(state, status, true);
    emit_status(app, status);

    // Defer cleanup so a checksum / size mismatch leaves no garbage in
    // the temp dir. The actual swap into `target_file` happens below
    // only after every verification step passes; if we bail early we
    // never touch `target_file`, so a corrupted previous install
    // stays usable and the next `check_for_updates` will keep
    // reporting the file as needing an update.
    let extract_dir = temp_dir.join(format!("extract_{}", file_index));

    if let Err(e) = fs::create_dir_all(&extract_dir) {
        let _ = fs::remove_file(&temp_file);
        return Err(e).with_context(|| {
            format!(
                "failed to create extract dir {} for {}",
                extract_dir.display(),
                file_item.file_path
            )
        });
    }
    let extract_result = extract_archive(app, &temp_file, &extract_dir, true);
    if let Err(e) = extract_result {
        let _ = fs::remove_file(&temp_file);
        let _ = fs::remove_dir_all(&extract_dir);
        return Err(e).with_context(|| {
            format!(
                "failed to extract {} into {} — the archive is truncated, \
                 corrupt, or its compressed payload did not match the size \
                 declared in the manifest",
                temp_file.display(),
                extract_dir.display()
            )
        });
    }

    let target_name = target_file
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| anyhow!("invalid target file name"))?;

    let extracted_file = find_extracted_file(&extract_dir, target_name).ok_or_else(|| {
        let _ = fs::remove_file(&temp_file);
        let _ = fs::remove_dir_all(&extract_dir);
        anyhow!("Extracted file not found for {}", file_item.file_path)
    })?;

    // Verify the extracted payload against the manifest BEFORE we touch
    // the on-disk target. The old code copied first and verified after,
    // which meant a truncated extraction overwrote the real file and
    // left the launcher wedged in an infinite "needs update" loop —
    // `get_files_to_update` then saw a 1455-byte file where the manifest
    // said 1458, trusted the local manifest's checksum, and refused to
    // mark the file as up-to-date forever. Verifying on `extracted_file`
    // first means we only swap the real target into place when we
    // already know the bytes are correct.
    let decompressed = match fs::read(&extracted_file) {
        Ok(bytes) => bytes,
        Err(e) => {
            let _ = fs::remove_file(&temp_file);
            let _ = fs::remove_dir_all(&extract_dir);
            return Err(e).with_context(|| {
                format!(
                    "failed to read extracted file {} before verification",
                    extracted_file.display()
                )
            });
        }
    };
    if decompressed.len() as u64 != file_item.entry.size {
        let _ = fs::remove_file(&temp_file);
        let _ = fs::remove_dir_all(&extract_dir);
        return Err(anyhow!(
            "Size mismatch for {}: expected {} bytes (manifest), got {} bytes \
             from extraction — the archive is truncated; the on-disk file at \
             {} has NOT been modified",
            file_item.file_path,
            file_item.entry.size,
            decompressed.len(),
            target_file.display()
        ));
    }

    let actual_checksum = calculate_checksum(&decompressed);
    let expected_checksum = normalize_checksum(&file_item.entry.checksum);
    if actual_checksum != expected_checksum {
        let _ = fs::remove_file(&temp_file);
        let _ = fs::remove_dir_all(&extract_dir);
        return Err(anyhow!(
            "Checksum mismatch for {}: expected {}, got {} — the archive is \
             corrupt; the on-disk file at {} has NOT been modified",
            file_item.file_path,
            expected_checksum,
            actual_checksum,
            target_file.display()
        ));
    }

    // Both verifications passed. Stage the new file alongside the
    // target, then atomically rename it into place so the publish is a
    // single atomic step. If the rename fails (locked file, AV
    // interference, perms) we leave the previous file untouched and
    // surface the error — the launcher keeps running on whatever was
    // there before.
    //
    // `Path::with_extension` REPLACES the extension rather than
    // appending, which would turn `ClientConfig.ini` into
    // `ClientConfig.zemu-new` (dropping the `.ini`). Append to the
    // stem explicitly instead.
    let sibling_name = match target_file.file_name().and_then(|n| n.to_str()) {
        Some(name) => format!("{name}.zemu-new"),
        None => {
            let _ = fs::remove_file(&temp_file);
            let _ = fs::remove_dir_all(&extract_dir);
            return Err(anyhow!(
                "target file {} has no usable filename component",
                target_file.display()
            ));
        }
    };
    let sibling = match target_file.parent() {
        Some(parent) => parent.join(sibling_name),
        None => PathBuf::from(sibling_name),
    };
    if let Err(e) = fs::write(&sibling, &decompressed) {
        let _ = fs::remove_file(&sibling);
        let _ = fs::remove_file(&temp_file);
        let _ = fs::remove_dir_all(&extract_dir);
        return Err(e).with_context(|| {
            format!(
                "failed to write staged replacement {} for {}",
                sibling.display(),
                target_file.display()
            )
        });
    }
    if let Err(e) = fs::rename(&sibling, &target_file) {
        let _ = fs::remove_file(&sibling);
        let _ = fs::remove_file(&temp_file);
        let _ = fs::remove_dir_all(&extract_dir);
        return Err(e).with_context(|| {
            format!(
                "failed to atomically replace {} with the freshly downloaded \
                 and verified file",
                target_file.display()
            )
        });
    }

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

    // Atomic rename succeeded; safe to remove the temp artefacts.
    let _ = fs::remove_file(&temp_file);
    let _ = fs::remove_dir_all(&extract_dir);
    Ok(())
}

/// Streams a `.tar.zst` archive into `destination`. Pure Rust via the
/// `tar` + `zstd` crates — no external extractor binary required.
///
/// `tar::Archive::set_overwrite(true)` matches the previous FreeArc `-o+`
/// behavior. `set_preserve_permissions(false)` keeps Windows happy when
/// tar entries carry Unix mode bits.
fn extract_archive(
    _app: &AppHandle,
    archive_file: &Path,
    destination: &Path,
    _single_file_mode: bool,
) -> Result<()> {
    fs::create_dir_all(destination)
        .with_context(|| format!("failed to create destination {}", destination.display()))?;

    let file = fs::File::open(archive_file)
        .with_context(|| format!("failed to open archive {}", archive_file.display()))?;
    let decoder = zstd::Decoder::new(file).with_context(|| {
        format!(
            "failed to start zstd decoder for {}",
            archive_file.display()
        )
    })?;
    let mut archive = tar::Archive::new(decoder);
    archive.set_preserve_permissions(false);
    archive.set_overwrite(true);
    archive
        .unpack(destination)
        .with_context(|| format!("failed to unpack archive {}", archive_file.display()))?;
    Ok(())
}

fn find_extracted_file(root: &Path, target_name: &str) -> Option<PathBuf> {
    for entry in WalkDir::new(root)
        .into_iter()
        .filter_map(|entry| entry.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        if entry
            .file_name()
            .to_str()
            .map(|name| name.eq_ignore_ascii_case(target_name))
            .unwrap_or(false)
        {
            return Some(entry.path().to_path_buf());
        }
    }
    None
}

fn persist_installed_manifest(
    app: &AppHandle,
    game_directory: &str,
    manifest: &VersionManifest,
) -> Result<()> {
    save_version_cache(app, manifest)?;

    let version_path = PathBuf::from(game_directory).join("version.json");
    let raw = serde_json::to_string_pretty(manifest)?;
    fs::write(version_path, raw)?;
    Ok(())
}

fn uses_file_level_manifest(manifest: &VersionManifest) -> bool {
    manifest
        .folders
        .values()
        .any(|folder| !folder.files.is_empty())
}

fn get_folders_to_update(remote: &VersionManifest, local: Option<&VersionManifest>) -> Vec<String> {
    let mut result = Vec::new();

    for (folder_name, folder_info) in &remote.folders {
        // Skip folders already covered by per-file downloads. The compressor
        // GUI uploads each file individually (e.g. `BEClient_x64.dll.tar.zst`
        // at the bucket root) and writes per-file entries under the folder,
        // but it does NOT upload the aggregate `folder-<version>.tar.zst`.
        // Trying to fetch that aggregate would 404, so exclude any folder
        // whose per-file entries already cover its contents.
        if !folder_info.files.is_empty() {
            continue;
        }

        let local_folder = local.and_then(|manifest| manifest.folders.get(folder_name));
        if folder_needs_update(local_folder, folder_info) {
            result.push(folder_name.clone());
        }
    }

    result
}

fn get_files_to_update(
    remote: &VersionManifest,
    local: Option<&VersionManifest>,
    game_directory: &str,
    verify_on_disk: bool,
) -> Result<Vec<FileUpdateItem>> {
    let mut files_to_update = Vec::new();
    let local_folders: HashMap<String, FolderManifestEntry> = local
        .map(|manifest| manifest.folders.clone())
        .unwrap_or_default();

    for (folder_name, folder_info) in &remote.folders {
        if folder_info.files.is_empty() {
            continue;
        }

        let local_folder = local_folders.get(folder_name);
        let has_local_file_info = local_folder
            .map(|entry| !entry.files.is_empty())
            .unwrap_or(false);

        for (file_key, file_entry) in &folder_info.files {
            // If the folder is "root", extract files to game directory root, not a subfolder.
            // For nested folders, use the path as-is when it's already prefixed with the
            // folder name (legacy / canonical layout) and otherwise prepend it so the file
            // lands in the right subdirectory.
            let relative_path = if folder_name == "root"
                || file_entry.path.starts_with(&format!("{folder_name}/"))
            {
                file_entry.path.clone()
            } else {
                format!("{folder_name}/{}", file_entry.path)
            };
            let absolute_path = PathBuf::from(game_directory).join(&relative_path);
            let expected_checksum = normalize_checksum(&file_entry.checksum);

            let mut needs_update = true;

            if has_local_file_info {
                if let Some(local_file) = local_folder.and_then(|folder| folder.files.get(file_key))
                {
                    let local_checksum = normalize_checksum(&local_file.checksum);
                    if local_checksum == expected_checksum && absolute_path.exists() {
                        if verify_on_disk {
                            let on_disk = fs::read(&absolute_path).ok();
                            if let Some(bytes) = on_disk {
                                let disk_checksum = calculate_checksum(&bytes);
                                if disk_checksum == expected_checksum {
                                    needs_update = false;
                                }
                            }
                        } else if let Ok(metadata) = fs::metadata(&absolute_path) {
                            // Fast path: trust local manifest if checksum matches and file size matches.
                            if metadata.len() == file_entry.size {
                                needs_update = false;
                            }
                        }
                    }
                }
            } else if absolute_path.exists() {
                if verify_on_disk {
                    if let Ok(bytes) = fs::read(&absolute_path) {
                        if calculate_checksum(&bytes) == expected_checksum {
                            needs_update = false;
                        }
                    }
                } else if let Ok(metadata) = fs::metadata(&absolute_path) {
                    // Fast path when local manifest has no per-file entries.
                    if metadata.len() == file_entry.size {
                        needs_update = false;
                    }
                }
            }

            if needs_update {
                files_to_update.push(FileUpdateItem {
                    folder_name: folder_name.clone(),
                    file_path: relative_path,
                    entry: file_entry.clone(),
                });
            }
        }
    }

    Ok(files_to_update)
}

fn load_local_manifest(game_directory: &str) -> Result<Option<VersionManifest>> {
    let path = PathBuf::from(game_directory).join("version.json");
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(&path)?;
    match serde_json::from_str::<VersionManifest>(&raw) {
        Ok(manifest) => Ok(Some(manifest)),
        Err(_) => Ok(None),
    }
}

fn compare_versions(v1: &str, v2: &str) -> i32 {
    let parts1: Vec<u32> = v1
        .split('.')
        .map(|item| item.parse::<u32>().unwrap_or(0))
        .collect();
    let parts2: Vec<u32> = v2
        .split('.')
        .map(|item| item.parse::<u32>().unwrap_or(0))
        .collect();

    let max_len = std::cmp::max(parts1.len(), parts2.len());
    for idx in 0..max_len {
        let part1 = *parts1.get(idx).unwrap_or(&0);
        let part2 = *parts2.get(idx).unwrap_or(&0);

        if part1 < part2 {
            return -1;
        }
        if part1 > part2 {
            return 1;
        }
    }

    0
}

fn normalize_checksum(value: &str) -> String {
    value.trim().trim_start_matches("sha256:").to_lowercase()
}

fn normalize_checksum_opt(value: Option<&str>) -> Option<String> {
    value
        .map(normalize_checksum)
        .filter(|checksum| !checksum.is_empty())
}

fn folder_needs_update(
    local_folder: Option<&FolderManifestEntry>,
    remote_folder: &FolderManifestEntry,
) -> bool {
    let Some(local_folder) = local_folder else {
        return true;
    };

    let local_checksum = normalize_checksum_opt(local_folder.checksum.as_deref());
    let remote_checksum = normalize_checksum_opt(remote_folder.checksum.as_deref());

    if let (Some(local), Some(remote)) = (local_checksum.as_ref(), remote_checksum.as_ref()) {
        return local != remote;
    }

    let mut compared_any = false;

    if let Some(remote_size) = remote_folder.size {
        compared_any = true;
        if local_folder.size != Some(remote_size) {
            return true;
        }
    }

    if let Some(remote_compressed_size) = remote_folder.compressed_size {
        compared_any = true;
        if local_folder.compressed_size != Some(remote_compressed_size) {
            return true;
        }
    }

    if remote_folder.file_count > 0 {
        compared_any = true;
        if local_folder.file_count != remote_folder.file_count {
            return true;
        }
    }

    if !remote_folder.files.is_empty() {
        compared_any = true;
        if local_folder.files.len() != remote_folder.files.len() {
            return true;
        }

        for (file_key, remote_file) in &remote_folder.files {
            let Some(local_file) = local_folder.files.get(file_key) else {
                return true;
            };

            if normalize_checksum(&local_file.checksum) != normalize_checksum(&remote_file.checksum)
            {
                return true;
            }

            if local_file.size != remote_file.size
                || local_file.compressed_size != remote_file.compressed_size
            {
                return true;
            }
        }
    }

    !compared_any
}

fn calculate_checksum(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn calculate_overall_progress(status: &UpdateStatus) -> f64 {
    let total_items = status.total_folders + status.total_files;
    if total_items == 0 {
        return 0.0;
    }

    // Count every fully-done item (completed after both download AND extract).
    // The in-progress item's partial progress is blended in to keep the bar
    // smooth and monotonically increasing — it never resets when download
    // finishes and decompress begins.
    let completed_items = status.completed_folders + status.completed_files;
    let in_progress_items = total_items - completed_items;

    let in_progress_pct = if let Some(files) = &status.files {
        files.iter().map(|f| f.progress).sum::<f64>() / files.len().max(1) as f64
    } else if !status.folders.is_empty() {
        status.folders.iter().map(|f| f.progress).sum::<f64>() / status.folders.len() as f64
    } else {
        0.0
    };

    // Each in-progress item contributes its progress as a fraction of total.
    // Completed items count as 100% each. This is monotonically increasing
    // because completed_items only grows.
    let total_progress =
        completed_items as f64 + (in_progress_pct / 100.0 * in_progress_items as f64);
    (total_progress / total_items as f64) * 100.0
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
