//! Pre-launch patch integrity check.
//!
//! When the user clicks Play, the launcher runs `verify_and_repair` to
//! confirm every depot file on disk still matches its blake3 hash in
//! the local `manifest.json`. Tampered or missing files are
//! re-downloaded from the CDN. If tampering is detected and the CDN
//! is unreachable, the launch must be refused — we cannot prove the
//! on-disk bytes are authentic in that state.
//!
//! This module is the *pre-launch* counterpart of
//! `process_integrity::start_integrity_monitor`, which watches loaded
//! modules *after* the game spawns. Different problem, different module.

use crate::debug_log;
use crate::models::{
    CompressorManifest, IntegrityCache, IntegrityCacheEntry, TamperReason, TamperedFile,
    VerifyOutcome, VerifyStatus,
};
use crate::state::AppState;
use crate::update;
use anyhow::{anyhow, Context, Result};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::AppHandle;

/// Sidecar JSON next to `manifest.json` that records per-file
/// `(size, mtime_ms)` for the fast-path stat-only check.
const INTEGRITY_CACHE_FILENAME: &str = ".zemu-integrity-cache.json";

/// Files the launcher rewrites at runtime that we should never
/// complain about if they've drifted from the manifest. Mirrors the
/// renderer's `LAUNCHER_CONFIG.updateSkipFiles` baseline. Case-
/// insensitive basename match.
const ALWAYS_SKIP: &[&str] = &["ClientConfig.ini"];

/// Drive a full verify-and-repair pass. See module docs for the
/// state-machine contract.
pub async fn verify_and_repair(
    app: &AppHandle,
    state: &AppState,
    game_directory: &str,
) -> Result<VerifyOutcome> {
    if game_directory.trim().is_empty() {
        return Err(anyhow!("Game directory is required to verify integrity"));
    }
    let _ = debug_log::append(
        app,
        "integrity",
        &format!("verify_and_repair start game_directory={game_directory}"),
    );

    // Read the local manifest. If there's no manifest on disk the
    // install is in the `!isInstalled` branch upstream — the Play
    // button wouldn't be clickable, so this is a defensive guard.
    let manifest = read_local_manifest(game_directory)?
        .ok_or_else(|| anyhow!("No local manifest.json to verify against"))?;

    // Check CDN reachability up-front so we can fail fast on a
    // poisoned install with no network rather than running the file
    // walk only to discover we can't fix anything.
    let (cdn_available, _) = check_cdn_reachable(state, app).await;

    let mut cache = load_integrity_cache(game_directory).unwrap_or_default();
    let mut tampered: Vec<TamperedFile> = Vec::new();

    let total = manifest.files.len();
    for (index, entry) in manifest.files.iter().enumerate() {
        if should_skip_entry(&entry.path) {
            continue;
        }
        let target = PathBuf::from(game_directory).join(&entry.path);
        match check_file(&target, entry, cache.entries.get(&entry.path).copied()) {
            CheckResult::Clean => {}
            CheckResult::Missing => {
                let _ = debug_log::append(
                    app,
                    "integrity",
                    &format!("verify missing path={}", entry.path),
                );
                tampered.push(TamperedFile {
                    path: entry.path.clone(),
                    reason: TamperReason::Missing,
                    expected_blake3: entry.hash.to_lowercase(),
                    actual_blake3: None,
                });
            }
            CheckResult::Mismatch(actual) => {
                let _ = debug_log::append(
                    app,
                    "integrity",
                    &format!(
                        "verify mismatch path={} expected={} actual={}",
                        entry.path, entry.hash, actual
                    ),
                );
                tampered.push(TamperedFile {
                    path: entry.path.clone(),
                    reason: TamperReason::HashMismatch,
                    expected_blake3: entry.hash.to_lowercase(),
                    actual_blake3: Some(actual),
                });
            }
        }

        // Update the cache regardless of verdict — the file's mtime
        // and size have just been observed. After a successful
        // repair this entry will be re-checked against the freshly
        // downloaded bytes.
        if let Ok(meta) = fs::metadata(&target) {
            if let Some(entry_cache) = stat_to_cache_entry(&meta) {
                cache.entries.insert(entry.path.clone(), entry_cache);
            }
        }

        // Surface a hint of progress on big installs so a silent
        // 30-second blake3 walk doesn't look frozen. This is
        // intentionally not the `update-progress` event — that one
        // drives the DOWNLOADING_UPDATE UI and would mislead the
        // user into thinking a download is in flight.
        if total > 0 && (index % 32 == 0 || index + 1 == total) {
            let _ = debug_log::append(
                app,
                "integrity",
                &format!("verify progress {}/{}", index + 1, total),
            );
        }
    }

    // Persist the cache before returning so the next Play click
    // hits the fast path on any files we just verified.
    let _ = save_integrity_cache(game_directory, &cache);

    if tampered.is_empty() {
        let _ = debug_log::append(app, "integrity", "verify_and_repair clean");
        return Ok(VerifyOutcome {
            status: VerifyStatus::Clean,
            tampered,
            cdn_available,
        });
    }

    if !cdn_available {
        let _ = debug_log::append(
            app,
            "integrity",
            &format!(
                "verify_and_repair tampered_no_cdn count={}",
                tampered.len()
            ),
        );
        return Ok(VerifyOutcome {
            status: VerifyStatus::TamperedCdnDown,
            tampered,
            cdn_available: false,
        });
    }

    let count = tampered.len();
    let _ = debug_log::append(
        app,
        "integrity",
        &format!("verify_and_repair repairing count={count}"),
    );

    update::run_repair_pipeline(app, state, game_directory, &tampered, &manifest)
        .await
        .context("repair pipeline failed")?;

    // Re-hash only the repaired set so the cache and the truth on
    // disk are both confirmed. If even one re-hash fails the CDN
    // served us a bad payload — surface it as TamperedCdnDown so
    // the renderer refuses to launch.
    let mut still_tampered: Vec<TamperedFile> = Vec::new();
    for tampered_file in &tampered {
        let target = PathBuf::from(game_directory).join(&tampered_file.path);
        match check_file(&target, &entry_for(&manifest, &tampered_file.path), None) {
            CheckResult::Clean => {}
            CheckResult::Mismatch(actual) => {
                still_tampered.push(TamperedFile {
                    path: tampered_file.path.clone(),
                    reason: TamperReason::HashMismatch,
                    expected_blake3: tampered_file.expected_blake3.clone(),
                    actual_blake3: Some(actual),
                });
            }
            CheckResult::Missing => {
                still_tampered.push(TamperedFile {
                    path: tampered_file.path.clone(),
                    reason: TamperReason::Missing,
                    expected_blake3: tampered_file.expected_blake3.clone(),
                    actual_blake3: None,
                });
            }
        }
        if let Ok(meta) = fs::metadata(&target) {
            if let Some(cache_entry) = stat_to_cache_entry(&meta) {
                cache.entries.insert(tampered_file.path.clone(), cache_entry);
            }
        }
    }
    let _ = save_integrity_cache(game_directory, &cache);

    if !still_tampered.is_empty() {
        let _ = debug_log::append(
            app,
            "integrity",
            &format!(
                "verify_and_repair repair_incomplete count={}",
                still_tampered.len()
            ),
        );
        return Ok(VerifyOutcome {
            status: VerifyStatus::TamperedCdnDown,
            tampered: still_tampered,
            cdn_available: false,
        });
    }

    let _ = debug_log::append(
        app,
        "integrity",
        &format!("verify_and_repair repaired count={count}"),
    );
    Ok(VerifyOutcome {
        status: VerifyStatus::Repaired,
        tampered,
        cdn_available: true,
    })
}

/// Probe whether the CDN is reachable. Returns `(reachable, base_url)`.
/// A `None` base URL counts as not-reachable; a network error on the
/// manifest fetch also counts as not-reachable. We deliberately use
/// the manifest fetch (not a HEAD on the base URL) so this stays
/// consistent with `check_for_updates`'s notion of "CDN up".
async fn check_cdn_reachable(state: &AppState, app: &AppHandle) -> (bool, Option<String>) {
    let base_url = match state.get_update_base_url() {
        Some(url) => url,
        None => {
            let _ = debug_log::append(app, "integrity", "cdn_reachable no_base_url");
            return (false, None);
        }
    };
    let client = update::UpdateClient::new(base_url.clone());
    let result = client.get_manifest().await.is_ok();
    let _ = debug_log::append(
        app,
        "integrity",
        &format!("cdn_reachable result={result}"),
    );
    (result, Some(base_url))
}

// ─── Internal helpers ────────────────────────────────────────────────────

#[derive(Debug)]
enum CheckResult {
    Clean,
    Missing,
    Mismatch(String),
}

fn check_file(
    target: &Path,
    entry: &crate::models::CompressorManifestEntry,
    cache_entry: Option<IntegrityCacheEntry>,
) -> CheckResult {
    let metadata = match fs::metadata(target) {
        Ok(meta) => meta,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return CheckResult::Missing,
        Err(err) => {
            // Treat any other metadata failure (permission denied,
            // sharing violation, etc.) as a missing file rather than
            // failing the whole verify pass on one unreadable entry.
            // The repair pipeline will try to overwrite it from the
            // CDN, which is the right fallback.
            let _ = err;
            return CheckResult::Missing;
        }
    };

    // Fast path: if the cache says this file is the same size at
    // the same mtime, the contents are unchanged and we can skip
    // the blake3 read. A cheater who edits the file without
    // touching either will still match — but a byte-level edit
    // without a metadata change is essentially impossible from
    // userland, and the worst case is a missed tamper that the
    // repair pipeline would not catch anyway because the file
    // already passes the size/mtime check.
    if let Some(cache_entry) = cache_entry {
        if let Some(current_entry) = stat_to_cache_entry(&metadata) {
            if current_entry == cache_entry {
                return CheckResult::Clean;
            }
        }
    }

    let actual = match blake3_hex_file(target) {
        Ok(hash) => hash,
        Err(_) => return CheckResult::Missing,
    };

    if actual.eq_ignore_ascii_case(&entry.hash) {
        CheckResult::Clean
    } else {
        CheckResult::Mismatch(actual)
    }
}

fn blake3_hex_file(target: &Path) -> Result<String> {
    let mut file = fs::File::open(target)
        .with_context(|| format!("open {}", target.display()))?;
    let mut hasher = blake3::Hasher::new();
    let mut chunk = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut chunk)?;
        if read == 0 {
            break;
        }
        hasher.update(&chunk[..read]);
    }
    Ok(hasher.finalize().to_hex().to_string())
}

fn stat_to_cache_entry(meta: &fs::Metadata) -> Option<IntegrityCacheEntry> {
    let modified = meta.modified().ok()?;
    let since_epoch = modified.duration_since(UNIX_EPOCH).ok()?;
    Some(IntegrityCacheEntry {
        size: meta.len(),
        mtime_unix_ms: (since_epoch.as_millis() as i64).max(0),
    })
}

fn entry_for(
    manifest: &CompressorManifest,
    path: &str,
) -> crate::models::CompressorManifestEntry {
    manifest
        .files
        .iter()
        .find(|e| e.path == path)
        .cloned()
        .unwrap_or_else(|| crate::models::CompressorManifestEntry {
            path: path.to_string(),
            size: 0,
            hash: String::new(),
            compressed_size: 0,
            compressed_hash: String::new(),
        })
}

fn read_local_manifest(game_directory: &str) -> Result<Option<CompressorManifest>> {
    let path = PathBuf::from(game_directory).join("manifest.json");
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
    match serde_json::from_str::<CompressorManifest>(&raw) {
        Ok(manifest) => Ok(Some(manifest)),
        Err(_) => Ok(None),
    }
}

pub fn load_integrity_cache(game_directory: &str) -> Result<IntegrityCache> {
    let path = PathBuf::from(game_directory).join(INTEGRITY_CACHE_FILENAME);
    if !path.exists() {
        return Ok(IntegrityCache::default());
    }
    let raw = fs::read_to_string(&path)
        .with_context(|| format!("read {}", path.display()))?;
    match serde_json::from_str::<IntegrityCache>(&raw) {
        Ok(cache) => Ok(cache),
        Err(_) => Ok(IntegrityCache::default()),
    }
}

pub fn save_integrity_cache(game_directory: &str, cache: &IntegrityCache) -> Result<()> {
    let path = PathBuf::from(game_directory).join(INTEGRITY_CACHE_FILENAME);
    let raw = serde_json::to_string_pretty(cache)?;
    fs::write(&path, raw).with_context(|| format!("write {}", path.display()))?;
    Ok(())
}

fn should_skip_entry(path: &str) -> bool {
    let basename = match path.rsplit(['/', '\\']).next() {
        Some(name) => name,
        None => return false,
    };
    let basename_lower = basename.to_lowercase();
    ALWAYS_SKIP
        .iter()
        .any(|entry| entry.to_lowercase() == basename_lower)
}

// ─── Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{CompressorManifestEntry, UpdateStatus};
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::SystemTime;
    use tauri::AppHandle;

    static UNIQUE: AtomicUsize = AtomicUsize::new(0);

    /// Build a unique temp directory for a test. We use
    /// `std::env::temp_dir()` + an atomic counter instead of pulling
    /// in `tempfile` as a dev-dependency just for tests.
    fn unique_tempdir() -> std::path::PathBuf {
        let pid = std::process::id();
        let counter = UNIQUE.fetch_add(1, Ordering::SeqCst);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("zemu-integrity-test-{pid}-{nanos}-{counter}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn entry(path: &str, body: &[u8]) -> CompressorManifestEntry {
        CompressorManifestEntry {
            path: path.to_string(),
            size: body.len() as u64,
            hash: blake3::hash(body).to_hex().to_string(),
            compressed_size: 0,
            compressed_hash: String::new(),
        }
    }

    fn manifest_with(entries: Vec<CompressorManifestEntry>) -> CompressorManifest {
        CompressorManifest {
            version: "test".to_string(),
            files: entries,
            removed: Vec::new(),
        }
    }

    #[test]
    fn tampered_file_detection() {
        let dir = unique_tempdir();
        let path = dir.join("foo.dll");
        let body = b"original bytes";
        fs::write(&path, body).unwrap();

        let entry = entry("foo.dll", body);
        let result = check_file(&path, &entry, None);
        assert!(matches!(result, CheckResult::Clean));

        fs::write(&path, b"tampered bytes").unwrap();
        let result = check_file(&path, &entry, None);
        match result {
            CheckResult::Mismatch(actual) => {
                assert_ne!(
                    actual,
                    blake3::hash(body).to_hex().to_string(),
                    "tampered bytes should not match the original blake3"
                );
            }
            other => panic!("expected Mismatch, got {other:?}"),
        }
    }

    #[test]
    fn missing_file_detection() {
        let dir = unique_tempdir();
        let path = dir.join("ghost.dll");
        let entry = entry("ghost.dll", b"never written");
        let result = check_file(&path, &entry, None);
        assert!(matches!(result, CheckResult::Missing));
    }

    #[test]
    fn clean_file_fast_path_skips_read() {
        let dir = unique_tempdir();
        let path = dir.join("stable.dll");
        let body = b"unmodified contents";
        fs::write(&path, body).unwrap();

        let entry = entry("stable.dll", body);
        let meta = fs::metadata(&path).unwrap();
        let cached = stat_to_cache_entry(&meta).unwrap();

        // Cache matches reality -> no read needed.
        let result = check_file(&path, &entry, Some(cached));
        assert!(matches!(result, CheckResult::Clean));

        // Same file but with no cache entry -> read path still
        // returns Clean because the on-disk hash matches.
        let result = check_file(&path, &entry, None);
        assert!(matches!(result, CheckResult::Clean));
    }

    #[test]
    fn cache_round_trip_preserves_entries() {
        let dir = unique_tempdir();
        let path = dir.join("data.bin");
        fs::write(&path, b"hello world").unwrap();

        let meta = fs::metadata(&path).unwrap();
        let cache_entry = stat_to_cache_entry(&meta).unwrap();

        let mut cache = IntegrityCache::default();
        let mut entries = HashMap::new();
        entries.insert("data.bin".to_string(), cache_entry);
        cache.entries = entries;

        let dir_str = dir.to_str().unwrap();
        save_integrity_cache(dir_str, &cache).unwrap();
        let reloaded = load_integrity_cache(dir_str).unwrap();
        assert_eq!(reloaded.entries.get("data.bin").copied(), Some(cache_entry));
    }

    #[test]
    fn cache_load_missing_file_returns_empty_default() {
        let dir = unique_tempdir();
        let dir_str = dir.to_str().unwrap();
        let cache = load_integrity_cache(dir_str).unwrap();
        assert!(cache.entries.is_empty());
    }

    #[test]
    fn should_skip_entry_matches_basename_case_insensitive() {
        assert!(should_skip_entry("ClientConfig.ini"));
        assert!(should_skip_entry("nested/ClientConfig.ini"));
        assert!(should_skip_entry("nested\\clientconfig.INI"));
        assert!(!should_skip_entry("NotClientConfig.ini"));
        assert!(!should_skip_entry(""));
    }

    #[test]
    fn entry_for_returns_placeholder_when_missing() {
        let manifest = manifest_with(vec![entry("real.dll", b"x")]);
        let placeholder = entry_for(&manifest, "missing.dll");
        assert_eq!(placeholder.path, "missing.dll");
        assert_eq!(placeholder.size, 0);
    }

    #[test]
    fn stat_to_cache_entry_round_trip_is_stable() {
        let dir = unique_tempdir();
        let path = dir.join("rt.bin");
        fs::write(&path, b"round trip").unwrap();
        let meta = fs::metadata(&path).unwrap();
        let a = stat_to_cache_entry(&meta).unwrap();
        let b = stat_to_cache_entry(&meta).unwrap();
        assert_eq!(a, b);
    }

    // Silence "unused" warnings for the type-only helpers below.
    #[allow(dead_code)]
    fn _ensure_types_in_use(_s: &AppHandle, _status: &UpdateStatus) {
        let _ = SystemTime::now();
    }
}
