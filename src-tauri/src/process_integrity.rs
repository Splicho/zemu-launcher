//! Periodic process-integrity (DLL injection) detection for the running
//! game.
//!
//! ## Why this exists
//!
//! The launcher's existing pre-launch file attestation (modeled after
//! `h1z1rotk`) verifies that `H1Z1.exe` and a small set of depot
//! DLLs on disk haven't been tampered with before the game starts.
//! That's necessary but not sufficient — a third-party DLL can be
//! loaded *after* launch (manual inject via `LoadLibrary`, public
//! cheats) without ever touching the on-disk game files.
//!
//! This module closes that gap by enumerating the live loaded-module
//! list of every `H1Z1.exe` (and its child processes) on a fixed
//! cadence, diffing it against a static allowlist, and POSTing
//! anything unknown to zemu-website's
//! `POST /v1/moderation/integrity/events` endpoint. The API fans
//! out to the `Integrity Alerts` tab (under the admin `Moderation`
//! group) and a configurable Discord channel via the existing bot
//! notifications pipeline.
//!
//! ## Design
//!
//! - One background thread per game launch (mirroring
//!   `start_game_process_monitor`'s lifecycle).
//! - Walks the root process tree on every tick to find `H1Z1.exe`
//!   PIDs; enumerates loaded modules for each via the Win32 Toolhelp
//!   + PSAPI APIs.
//! - Allowlist is a `&'static [&'static str]` of well-known DLL
//!   basenames (graphics runtimes + common system DLLs) joined with
//!   the per-launch depot-installed DLL list read from the
//!   updater's `manifest.json` (the same files
//!   `models::CompressorManifest` tracks for delta updates). The
//!   list is basenames-only — no paths, no runtime overrides, no
//!   user-editable sidecar. If a legit DLL isn't on the list, the
//!   fix is a code change + launcher update, not a config edit.
//! - Findings are deduped per `(PID, module_basename_lc)` per
//!   session and rate-limited to one HTTP POST every
//!   [`MIN_REPORT_INTERVAL`] overall — a flood of injected DLLs
//!   can't DOS the API.
//! - Stops when the root process tree exits (same exit condition as
//!   `start_game_process_monitor`).
//!
//! ## Cross-platform
//!
//! The whole module compiles behind `#[cfg(target_os = "windows")]`
//! so non-Windows builds (macOS / Linux dev hosts) stay clean.
//! `start_integrity_monitor` on a non-Windows target becomes a no-op
//! log line, matching the per-platform degradation pattern of the
//! game-launch path itself.
//!
//! ## Wire shape
//!
//! ```json
//! POST /v1/moderation/integrity/events
//! {
//!   "occurredAt": "2026-09-26T20:31:04.123Z",
//!   "gamePid": 1234,
//!   "gameStartedAt": "2026-09-26T20:25:11.000Z",
//!   "unknownModules": [
//!     {
//!       "modulePath": "C:\\…\\cheat.dll",
//!       "moduleSha256": "ab12…",
//!       "firstSeenAt": "2026-09-26T20:31:04.123Z"
//!     }
//!   ]
//! }
//! ```
//!
//! If `unknownModules` is empty no POST fires — only real findings
//! cross the wire.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::AppHandle;

#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::CloseHandle;
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Module32FirstW, Module32NextW, MODULEENTRY32W,
    TH32CS_SNAPMODULE, TH32CS_SNAPMODULE32,
};

use crate::debug_log;
#[cfg(target_os = "windows")]
use crate::game::collect_process_tree;
use crate::hardware_api::{self, ApiPostError};
use crate::models::CompressorManifest;

// ─── Configuration ────────────────────────────────────────────────────────

/// Cadence at which the monitor scans the game process tree. Cheap
/// (single `Toolhelp` snapshot per scan), so 2 s matches the
/// existing `start_game_process_monitor` cadence — keeps a single
/// dominant "tick" in the launcher's logging output.
const POLL_INTERVAL: Duration = Duration::from_secs(2);

/// Hard floor between HTTP POSTs to zemu-website. Findings arriving
/// faster than this get buffered into the next eligible window so a
/// flood of injected DLLs can't DOS the API.
const MIN_REPORT_INTERVAL: Duration = Duration::from_secs(30);

/// Lowercase basenames of well-known DLLs H1Z1.exe legitimately
/// loads. The allowlist joins this list at runtime with the
/// per-launch depot manifest (so a fresh `dinput8.dll` the launcher
/// dropped into the game folder never fires), plus auto-allow by
/// path prefix for `C:\Windows\System32\` and friends.
///
/// **Source of truth.** This `static` lives in the Rust crate, so
/// it ships compiled into `zemu_launcher.exe`. It's not bundled
/// into the renderer / Tauri webview JS — a user with the binary
/// can extract the strings, but they cannot mutate the list
/// without rebuilding the launcher. If a legit DLL starts
/// false-positiving, edit this array and cut a release.
const STATIC_DLL_ALLOWLIST: &[&str] = &[
    // DirectX runtime
    "d3d11.dll",
    "d3d12.dll",
    "dxgi.dll",
    "d3dcompiler_47.dll",
    "d3d9.dll",
    "d3d10.dll",
    "d3d10core.dll",
    "d3dcompiler_43.dll",
    // Vulkan / loader
    "vulkan-1.dll",
    "vulkan_loader.dll",
    // OpenGL ICDs (some launchers ship these in the game folder;
    // common whitelist item for anti-cheat avoid lists).
    "opengl32.dll",
    "atioglxx.dll",
    "atiadlxx.dll",
    // Common overlay / helper DLLs. Not exhaustive — these are the
    // ones that ship alongside the game legitimately on a lot of
    // setups. Add more as false-positives surface.
    "version.dll",
    "winmm.dll",
    "msvcrt.dll",
    "ucrtbase.dll",
    "vcruntime140.dll",
    "vcruntime140_1.dll",
    "msvcp140.dll",
    "msvcp140_1.dll",
    "msvcp140_2.dll",
    "concrt140.dll",
    // Steam overlay / Steamworks (ships alongside the game in depot).
    // `steam_api64.dll` is on the depot manifest; the renderer ships
    // alongside it and is essentially always present.
    "gameoverlayrenderer.dll",
    "gameoverlayrenderer64.dll",
    "steam_api.dll",
    // DirectInput / XInput (game controller input stacks).
    "dinput.dll",
    "xinput1_1.dll",
    "xinput1_2.dll",
    "xinput1_3.dll",
    "xinput1_4.dll",
    // DirectX audio (legacy Win10+ redistributable).
    "xaudio2_7.dll",
    "xaudio2_8.dll",
    "xaudio2_9.dll",
    "x3daudio1_0.dll",
    "x3daudio1_7.dll",
    "xactengine2_0.dll",
    "xactengine2_4.dll",
    "xactengine2_7.dll",
    "xactengine2_9.dll",
    "xactengine3_0.dll",
    "xactengine3_1.dll",
    "xactengine3_2.dll",
    "xactengine3_3.dll",
    "xactengine3_4.dll",
    "xactengine3_5.dll",
    "xactengine3_6.dll",
    "xactengine3_7.dll",
    "xapofx1_1.dll",
    "xapofx1_2.dll",
    "xapofx1_3.dll",
    "xapofx1_4.dll",
    "xapofx1_5.dll",
    // Modern Win11 gamepad / game input stacks.
    "gameinput.dll",
    "gameinputredist.dll",
    "xdstorage.dll",
    "dstorage.dll",
    "dxilconv.dll",
    // Microsoft .NET / XNA — H1Z1's UI may pull CLR when an XNA
    // control surface is opened in the renderer.
    "mscoree.dll",
    "mscorlib.dll",
    "mscoreei.dll",
    // Windows Imaging Component + common graphics stack helpers
    // loaded by some renderer paths.
    "windowscodecs.dll",
    "dcomp.dll",
    "dxgi1_2.dll",
    "dxgi1_3.dll",
    "dxgi1_4.dll",
    "dxgi1_5.dll",
    "dxgi1_6.dll",
    // Bonjour (Applie)
    "mdnsNSP.dll",
    // H1Z1 Game Client DLLs
    "BEClient_x64.dll",
    "dinput8.dll",
    "ortp_x64.dll",
    "steam_api64.dll",
    "vivoxoal_x64.dll",
    "vivoxsdk_x64.dll",
    // Audio decoder the launcher drops into the game folder. Lives
    // under `C:\ZEmu\<dep>` so it never appears under a system
    // path prefix — allowed by basename here.
    "libsndfile_x64-1.dll",
    // RivaTuner Statistics Server
    "RTSSHooks64.dll",
    // Medal TV
    "medal-hook64.dll",
    // Windows Defender
    "MpOav.dll"
];

/// Path prefixes that auto-allow any DLL under them. Windows system
/// folders are always safe — we never want to flag `kernel32.dll` or
/// `ntdll.dll`. Case-insensitive on Windows.
///
/// Intentionally narrow: only Windows system folders. Vendor GPU
/// drivers and overlays are caught by the static basename list
/// (e.g. `nvwgf2umx.dll`, `atiuxp64.dll`, `gameoverlayrenderer.dll`)
/// when they load from non-system paths — extending the prefix list
/// to `Program Files\*NVIDIA*` etc. would let an attacker drop a
/// DLL under any matching prefix and bypass the check.
const SYSTEM_PATH_PREFIXES: &[&str] = &[
    "c:\\windows\\system32\\",
    "c:\\windows\\syswow64\\",
    "c:\\windows\\winsxs\\",
];

// ─── Wire types ───────────────────────────────────────────────────────────

/// One unknown module reported to the API. `moduleSha256` is over the
/// on-disk file at `firstSeenAt`, not the basename — two paths
/// pointing at the same DLL collapse into one signal.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UnknownModule {
    module_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    module_sha256: Option<String>,
    first_seen_at: DateTime<Utc>,
}

/// Request body for `POST /v1/moderation/integrity/events`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessIntegrityEvent {
    occurred_at: DateTime<Utc>,
    game_pid: u32,
    game_started_at: DateTime<Utc>,
    unknown_modules: Vec<UnknownModule>,
}

// ─── Public API ───────────────────────────────────────────────────────────

/// Spawn the integrity monitor thread. Mirrors the lifecycle of
/// `start_game_process_monitor`: one thread per `launch_game` call,
/// exits when the root process tree is gone.
///
/// `root_pid` is the launcher's spawned child (typically `H1Z1.exe`).
/// `exe_basename` is the lowercase basename of that process — used
/// to identify the game PIDs in the tree (we still scan every PID
/// in the tree, not just `root_pid`, because anti-cheats / launchers
/// spawn intermediate parents that themselves load modules).
///
/// On non-Windows targets this is a one-shot log line and a no-op
/// thread — the module enumeration API isn't available there.
pub fn start_integrity_monitor(app: AppHandle, root_pid: u32, exe_basename: String) {
    let game_started_at = Utc::now();

    // The depot-installed DLL list (read from the updater's manifest
    // in `~/.zemu/<depot-id>/manifest.json`) is the only piece of the
    // allowlist that's per-launch. Reading it from the same file the
    // updater wrote keeps the launcher's view of "what files the
    // depot dropped into my game folder" consistent across launch /
    // update / integrity-check.
    let depot_dlls = read_depot_allowlist(&app);

    let thread_name = format!("integrity-monitor({})", root_pid);
    let _ = thread::Builder::new()
        .name(thread_name)
        .spawn(move || {
            run_monitor(
                app.clone(),
                root_pid,
                exe_basename,
                depot_dlls,
                game_started_at,
            );
        })
        .map_err(|err| {
            eprintln!("[integrity] failed to spawn monitor thread: {err}");
        });
}

// ─── Monitor loop ─────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn run_monitor(
    app: AppHandle,
    root_pid: u32,
    exe_basename: String,
    depot_dlls: Vec<String>,
    game_started_at: DateTime<Utc>,
) {
    let exe_basename_lc = exe_basename.to_lowercase();
    let allowlist = Allowlist::new(depot_dlls, &exe_basename_lc);

    // Per-session dedup: `(pid, module_basename_lc) -> first_seen`.
    // Skipping already-reported findings keeps the channel quiet
    // during a long injection session.
    let mut reported: HashMap<(u32, String), DateTime<Utc>> = HashMap::new();
    // Cap to prevent unbounded growth across very long sessions.
    // Trim to the most-recent N entries whenever we cross the cap;
    // N is generous because process trees stay small.
    const REPORTED_CAP: usize = 4096;

    let mut last_report_at: Option<Instant> = None;

    let _ = debug_log::append(
        &app,
        "integrity",
        &format!(
            "monitor started root_pid={} exe={} allowlist_static={} depot={}",
            root_pid,
            exe_basename_lc,
            STATIC_DLL_ALLOWLIST.len(),
            allowlist.depot_count
        ),
    );

    loop {
        // Exit condition: the root process tree is gone, same as
        // `start_game_process_monitor`. Re-uses
        // `collect_process_tree` for the walking machinery so the
        // tree edges stay in sync with the orphan-kill sweep.
        let tree = collect_process_tree(root_pid);
        if tree.is_empty() {
            let _ = debug_log::append(
                &app,
                "integrity",
                &format!("root tree gone; stopping monitor root_pid={}", root_pid),
            );
            break;
        }

        // Game PIDs are any node whose basename matches `exe_basename`.
        // Walking the whole tree (not just `root_pid`) catches
        // re-spawns / launchers that fork a fresh game process.
        let game_pids: Vec<u32> = tree
            .iter()
            .filter_map(|(pid, name)| {
                if name == &exe_basename_lc {
                    Some(*pid)
                } else {
                    None
                }
            })
            .collect();

        if game_pids.is_empty() {
            // The game exe isn't (or no longer is) in the tree. The
            // orphan-kill sweep will sweep the remaining tree nodes
            // itself; we just hold the thread until `root_pid`
            // itself dies (the parent launch wrapper) and then
            // exit the loop above.
            sleep_poll_interval();
            continue;
        }

        // Enumerate modules for every game PID and collect findings.
        // `UnknownModule` carries one entry per unknown DLL per scan;
        // dedup happens below.
        let now = Utc::now();
        let mut findings: HashMap<String, UnknownModule> = HashMap::new();

        for &pid in &game_pids {
            let modules = match enumerate_modules(pid) {
                Ok(m) => m,
                Err(err) => {
                    // Process might have just exited; the next scan
                    // will re-resolve. Don't spam the log.
                    if !matches!(err, EnumError::AccessDenied) {
                        let _ = debug_log::append(
                            &app,
                            "integrity",
                            &format!("enumerate_modules pid={} failed: {:?}", pid, err),
                        );
                    }
                    continue;
                }
            };

            for module_path in modules {
                let module_path_str = module_path.to_string_lossy().to_string();
                let basename = module_basename_lc(&module_path);

                if allowlist.is_allowed(&module_path, &basename) {
                    continue;
                }

                // Dedup on (pid, basename) — a module that was
                // flagged last tick and is still loaded isn't a new
                // finding, so we drop it here. Per-PID dedup also
                // keeps one injected DLL × two game PIDs from
                // duplicating in the wire payload.
                let key = (pid, basename.clone());
                let first_seen = match reported.get(&key) {
                    Some(existing) => *existing,
                    None => {
                        reported.insert(key, now);
                        now
                    }
                };

                let entry = findings
                    .entry(basename.clone())
                    .or_insert_with(|| UnknownModule {
                        module_path: module_path_str.clone(),
                        module_sha256: None,
                        first_seen_at: first_seen,
                    });
                // Preserve earliest first-seen across multiple PIDs
                // loading the same DLL.
                if first_seen < entry.first_seen_at {
                    entry.first_seen_at = first_seen;
                }
            }
        }

        // Trim the dedup table if it's grown too large. Drop the
        // oldest half so a very long session doesn't leak memory.
        if reported.len() > REPORTED_CAP {
            let mut entries: Vec<_> = reported.drain().collect();
            entries.sort_by_key(|(_, ts)| *ts);
            entries.truncate(REPORTED_CAP / 2);
            reported = entries.into_iter().collect();
        }

        if findings.is_empty() {
            sleep_poll_interval();
            continue;
        }

        // Backfill SHA-256 over the on-disk file lazily — one hash
        // per unique module path, only when we actually have a
        // finding to send. A failed hash (file deleted between
        // enumeration and read) leaves the field null; the API
        // accepts that and surfaces "hash unavailable" in the UI.
        let mut unknown_modules: Vec<UnknownModule> =
            findings.into_iter().map(|(_, mut m)| {
                m.module_sha256 = sha256_of_file(Path::new(&m.module_path));
                m
            }).collect();
        unknown_modules.sort_by(|a, b| a.module_path.cmp(&b.module_path));

        // Rate-limit: hold the report until at least
        // `MIN_REPORT_INTERVAL` has elapsed since the last successful
        // send. Drop the current findings (they'll re-surface next
        // scan if the module is still loaded).
        if let Some(prev) = last_report_at {
            if prev.elapsed() < MIN_REPORT_INTERVAL {
                sleep_poll_interval();
                continue;
            }
        }

        let event = ProcessIntegrityEvent {
            occurred_at: now,
            game_pid: *game_pids.first().unwrap_or(&root_pid),
            game_started_at,
            unknown_modules,
        };

        // TEMP-DISABLE: process-integrity reports to the API.
        //   The detector still runs (DLL enumeration, allowlist match,
        //   log line, kill) — only the network POST is suppressed so
        //   the moderation API isn't flooded until the rework lands.
        //   Re-enable the `post_event` call (and remove this branch)
        //   when the rework ships.
        //   See ticket: rework process-integrity reports.
        let _ = debug_log::append(
            &app,
            "integrity",
            &format!(
                "would-report {} unknown module(s) game_pid={} (api-post disabled)",
                event.unknown_modules.len(),
                event.game_pid
            ),
        );
        last_report_at = Some(Instant::now());
        continue;

        sleep_poll_interval();
    }
}

#[cfg(not(target_os = "windows"))]
fn run_monitor(
    app: AppHandle,
    root_pid: u32,
    exe_basename: String,
    depot_dlls: Vec<String>,
    _game_started_at: DateTime<Utc>,
) {
    let _ = debug_log::append(
        &app,
        "integrity",
        &format!(
            "monitor disabled on this platform root_pid={} exe={} depot={}",
            root_pid,
            exe_basename,
            depot_dlls.len()
        ),
    );
}

fn sleep_poll_interval() {
    // Park the thread on a oneshot channel rather than `sleep`
    // directly so a future "stop the monitor early" signal can wake
    // it. Today the monitor stops only when the root tree exits,
    // which is checked at the top of the loop, so the wakeup is
    // cosmetic. Kept so the structure is in place when an
    // explicit-stop signal is added later.
    let (_tx, rx) = mpsc::channel::<()>();
    let _ = rx.recv_timeout(POLL_INTERVAL);
}

// ─── Allowlist ────────────────────────────────────────────────────────────

#[derive(Debug)]
struct Allowlist {
    static_basenames: HashSet<String>,
    depot_basenames: HashSet<String>,
    exe_basename: String,
    /// Stashed so the debug-log line at startup can show what was
    /// loaded — never used at runtime.
    depot_count: usize,
}

impl Allowlist {
    fn new(depot_dlls: Vec<String>, exe_basename: &str) -> Self {
        // Lowercase at insertion. `is_allowed` is called with the
        // basename already lowered by `module_basename_lc`, so a
        // mixed-case entry like `"mdnsNSP.dll"` in the static list
        // would otherwise never match a lowered lookup.
        let mut static_basenames: HashSet<String> = STATIC_DLL_ALLOWLIST
            .iter()
            .map(|s| s.to_lowercase())
            .collect();
        // Add the game exe itself so the toolhelp enumeration
        // doesn't flag the very first entry on every scan.
        static_basenames.insert(exe_basename.to_lowercase());

        let depot_basenames: HashSet<String> =
            depot_dlls.iter().map(|p| module_basename_lc(Path::new(p))).collect();
        // `module_basename_lc` may have dropped empty strings for
        // paths that don't look like files; nothing to do — the
        // allowlist simply won't contain them.

        // Pre-count for the startup log line.
        let depot_count = depot_basenames.len();

        Self {
            static_basenames,
            depot_basenames,
            exe_basename: exe_basename.to_lowercase(),
            depot_count,
        }
    }

    fn is_allowed(&self, path: &Path, basename_lc: &str) -> bool {
        // System folder prefix check (case-insensitive on Windows;
        // the constants are already lowercase).
        let path_lc = path.to_string_lossy().to_lowercase();
        for prefix in SYSTEM_PATH_PREFIXES {
            if path_lc.starts_with(prefix) {
                return true;
            }
        }

        if self.static_basenames.contains(basename_lc) {
            return true;
        }

        if self.depot_basenames.contains(basename_lc) {
            return true;
        }

        // The game exe matches its own basename — handled by the
        // static list above, but kept here as a defence-in-depth.
        if basename_lc == self.exe_basename {
            return true;
        }

        false
    }
}

fn module_basename_lc(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

// ─── Module enumeration (Windows) ──────────────────────────────────────────

#[derive(Debug)]
enum EnumError {
    AccessDenied,
    /// Wrapper variant so the OS error code is preserved for
    /// debugging without a `dead_code` warning on a field that's
    /// only constructed in one branch.
    SnapshotFailed(#[allow(dead_code)] u32),
    Empty,
}

/// Snapshot the loaded modules for a given PID. Uses the Toolhelp API
/// (`CreateToolhelp32Snapshot(TH32CS_SNAPMODULE)` +
/// `Module32First/Next`) — the same call the existing
/// `start_game_process_monitor` uses for process enumeration, so we
/// keep the dependency footprint minimal.
///
/// Returns the full on-disk path of each module. The caller hashes
/// + diffs the paths; this function is pure and side-effect-free.
#[cfg(target_os = "windows")]
fn enumerate_modules(pid: u32) -> Result<Vec<PathBuf>, EnumError> {
    // SAFETY: `CreateToolhelp32Snapshot` is FFI; flags are validated
    // by the kernel, and we always `CloseHandle` on the path out.
    let snap = unsafe {
        CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid)
    };
    if snap.is_null() {
        // ERROR_ACCESS_DENIED when the process is in a different
        // session / integrity level we can't open. Treat as empty
        // so the caller retries next tick.
        let err = std::io::Error::last_os_error();
        let code = err.raw_os_error().unwrap_or(0);
        if code == 5 {
            return Err(EnumError::AccessDenied);
        }
        return Err(EnumError::SnapshotFailed(code as u32));
    }

    let mut entry: MODULEENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<MODULEENTRY32W>() as u32;

    let mut modules: Vec<PathBuf> = Vec::new();
    let mut ok = unsafe { Module32FirstW(snap, &mut entry) };
    while ok != 0 {
        let path = wide_to_path(&entry.szExePath);
        if !path.as_os_str().is_empty() {
            modules.push(path);
        }
        ok = unsafe { Module32NextW(snap, &mut entry) };
    }

    // SAFETY: `CloseHandle` on the snapshot handle we opened above.
    unsafe {
        CloseHandle(snap);
    }

    if modules.is_empty() {
        Err(EnumError::Empty)
    } else {
        Ok(modules)
    }
}

/// Convert a `WCHAR` buffer (UTF-16LE) into a `PathBuf`, trimming at
/// the first NUL. `szExePath` is a fixed `[u16; MAX_PATH]` buffer
/// the Win32 APIs hand us.
#[cfg(target_os = "windows")]
fn wide_to_path(raw: &[u16]) -> PathBuf {
    let len = raw.iter().position(|&c| c == 0).unwrap_or(raw.len());
    String::from_utf16_lossy(&raw[..len]).into()
}

#[cfg(not(target_os = "windows"))]
fn enumerate_modules(_pid: u32) -> Result<Vec<PathBuf>, EnumError> {
    Err(EnumError::Empty)
}

// ─── Depot allowlist reading ──────────────────────────────────────────────

/// Walk the install directories looking for any `manifest.json`
/// produced by the updater and collect every file path it lists.
/// Returns lowercase basenames — the integrity check is on basename,
/// not on the depot's folder layout, because a depot might install
/// to `Bin64/...` on one launch and a different prefix after a

/// Walk the install directories looking for any `manifest.json`
/// produced by the updater and collect every file path it lists.
/// Returns lowercase basenames — the integrity check is on basename,
/// not on the depot's folder layout, because a depot might install
/// to `Bin64/...` on one launch and a different prefix after a
/// re-install.
fn read_depot_allowlist(_app: &AppHandle) -> Vec<String> {
    let candidates = depot_manifest_candidates();
    let mut allowlist: Vec<String> = Vec::new();
    for path in candidates {
        if let Ok(text) = std::fs::read_to_string(&path) {
            match serde_json::from_str::<CompressorManifest>(&text) {
                Ok(manifest) => {
                    for file in manifest.files {
                        allowlist.push(file.path);
                    }
                }
                Err(err) => {
                    eprintln!(
                        "[integrity] manifest parse failed for {}: {err}",
                        path.display()
                    );
                }
            }
        }
    }
    allowlist
}

/// Best-effort list of `manifest.json` paths the updater drops. The
/// launcher's `storage::depot_directory` is the canonical location
/// (`~/.zemu/<depot-id>/manifest.json`); we enumerate any
/// `<root>/<depot-id>/manifest.json` under each known root so a
/// future second depot doesn't need a code change here.
///
/// `storage` is intentionally not imported — this module is meant
/// to be independent of any one storage layout. The path list is
/// best-effort and intentionally narrow: false negatives (a depot
/// DLL we don't know about) just become an integrity event, which
/// is the desired failure mode.
fn depot_manifest_candidates() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();

    // Pull the platform-specific appdata path via `dirs` directly
    // so we don't drag `storage` into this module.
    let Some(roots) = candidate_depot_roots() else {
        return out;
    };

    for root in roots {
        // One subfolder per depot-id. The updater writes the
        // manifest into the root of that folder.
        let entries = match std::fs::read_dir(&root) {
            Ok(it) => it,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let manifest = entry.path().join("manifest.json");
            if manifest.is_file() {
                out.push(manifest);
            }
        }
    }

    out
}

fn candidate_depot_roots() -> Option<Vec<PathBuf>> {
    let mut out: Vec<PathBuf> = Vec::new();

    // Windows: `%APPDATA%/zemu-launcher/depot` (or `%LOCALAPPDATA%`)
    // macOS:   `~/Library/Application Support/zemu-launcher/depot`
    // Linux:   `$XDG_DATA_HOME/zemu-launcher/depot` (default `~/.local/share/...`)
    #[cfg(target_os = "windows")]
    {
        if let Some(base) = dirs::data_dir() {
            out.push(base.join("zemu-launcher").join("depot"));
        }
        if let Some(base) = dirs::data_local_dir() {
            out.push(base.join("zemu-launcher").join("depot"));
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            out.push(
                home.join("Library")
                    .join("Application Support")
                    .join("zemu-launcher")
                    .join("depot"),
            );
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(base) = dirs::data_dir() {
            out.push(base.join("zemu-launcher").join("depot"));
        }
    }

    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

// ─── SHA-256 ──────────────────────────────────────────────────────────────

/// Hash a file's bytes with SHA-256. Returns `None` when the file is
/// gone between enumeration and read (typical when a DLL is
/// deleted from `Temp/` mid-session) or when reads fail. The
/// integrity event still posts with a null hash — the basename
/// alone is enough to alert on.
fn sha256_of_file(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Some(hex_lower(&hasher.finalize()))
}

/// Format a digest as lowercase hex without a heap-allocated
/// intermediate string per byte. Same shape as the rest of the
/// launcher's hex output.
fn hex_lower(bytes: &[u8]) -> String {
    const TABLE: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(TABLE[(b >> 4) as usize] as char);
        out.push(TABLE[(b & 0x0f) as usize] as char);
    }
    out
}

// ─── API POST ─────────────────────────────────────────────────────────────

/// POST a `ProcessIntegrityEvent` to the api. Reuses the existing
/// launcher-JWT helper from `hardware_api` so auth/host/error
/// handling stay consistent with the rest of the launcher's
/// server-facing requests.
fn post_event(app: &AppHandle, event: &ProcessIntegrityEvent) -> Result<(), ApiPostError> {
    let path = "/v1/moderation/integrity/events";
    let body = serde_json::to_vec(event).map_err(|err| {
        ApiPostError::Other(format!("serialise integrity event: {err}"))
    })?;
    hardware_api::api_post_json(app, path, &body)
}

// ─── Helpers used by tests / debugging only ───────────────────────────────

/// Sanity helper for unit tests: classify a single module path as
/// allowed / not allowed using the same logic the monitor uses,
/// without spinning up the thread.
#[cfg(test)]
fn classify_for_test(path: &str, depot_dlls: &[&str], exe_basename: &str) -> bool {
    let path_buf = PathBuf::from(path);
    let basename = module_basename_lc(&path_buf);
    let depot: Vec<String> = depot_dlls.iter().map(|s| s.to_string()).collect();
    let allowlist = Allowlist::new(depot, exe_basename);
    allowlist.is_allowed(&path_buf, &basename)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_system32_dlls() {
        assert!(classify_for_test(
            "C:\\Windows\\System32\\kernel32.dll",
            &[],
            "h1z1.exe"
        ));
    }

    #[test]
    fn allows_syswow64_dlls() {
        assert!(classify_for_test(
            "C:\\Windows\\SysWOW64\\version.dll",
            &[],
            "h1z1.exe"
        ));
    }

    #[test]
    fn allows_static_allowlist_dlls() {
        assert!(classify_for_test(
            "C:\\Game\\vulkan-1.dll",
            &[],
            "h1z1.exe"
        ));
        assert!(classify_for_test(
            "C:\\Game\\d3d12.dll",
            &[],
            "h1z1.exe"
        ));
    }

    #[test]
    fn allows_game_exe_itself() {
        assert!(classify_for_test("C:\\Game\\H1Z1.exe", &[], "h1z1.exe"));
    }

    #[test]
    fn allows_depot_manifest_files_by_basename() {
        assert!(classify_for_test(
            "C:\\Game\\dinput8.dll",
            &["dinput8.dll"],
            "h1z1.exe"
        ));
    }

    #[test]
    fn flags_unknown_dll() {
        assert!(!classify_for_test(
            "C:\\Users\\cheater\\AppData\\Local\\Temp\\hack.dll",
            &[],
            "h1z1.exe"
        ));
    }

    #[test]
    fn flags_dll_in_game_dir_not_on_manifest() {
        // A DLL in the game's own folder that's not on the manifest
        // is still flagged — `module_basename_lc` is the allowlist
        // key, not the folder layout.
        assert!(!classify_for_test(
            "C:\\Game\\unknown-overlay.dll",
            &[],
            "h1z1.exe"
        ));
    }

    #[test]
    fn allows_depot_manifest_with_subdir() {
        // Manifest uses forward slashes per the contract in models.rs;
        // we look up by basename so the folder layout doesn't matter.
        assert!(classify_for_test(
            "C:\\Game\\Bin64\\steam_api64.dll",
            &["Bin64/steam_api64.dll"],
            "h1z1.exe"
        ));
    }

    #[test]
    fn allows_bonjour_mdns_via_path_prefix() {
        // `mdnsNSP.dll` is on the static list AND lives under
        // `C:\Program Files\Bonjour\` — verify the static-list
        // path matches even without system-folder context.
        assert!(classify_for_test(
            "C:\\Program Files\\Bonjour\\mdnsNSP.dll",
            &[],
            "h1z1.exe"
        ));
    }

    #[test]
    fn allows_libsndfile_dropped_into_launcher_dir() {
        // `libsndfile_x64-1.dll` is shipped by the launcher under
        // its install root. Not a system path, not on the depot
        // manifest — it's static-list-only.
        assert!(classify_for_test(
            "C:\\ZEmu\\libsndfile_x64-1.dll",
            &[],
            "h1z1.exe"
        ));
    }

    #[test]
    fn sha256_of_known_string_matches() {
        let path = std::env::temp_dir().join("zemu_integrity_sha256_test.bin");
        std::fs::write(&path, b"abc").unwrap();
        let h = sha256_of_file(&path).unwrap();
        assert_eq!(
            h,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn hex_lower_formats_correctly() {
        assert_eq!(hex_lower(&[0x00, 0xff, 0xab]), "00ffab");
    }
}

// (No stray imports to suppress — `process_integrity` is fully
// gated on Windows and the unused import warnings are pruned by
// the cfg attributes inside the module.)
