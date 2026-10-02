//! Build-time config injection.
//!
//! Reads `../update-config.json` + `../src/config/launcher.ts` and
//! emits `OUT_DIR/config.rs` with the bundled compile-time
//! constants the Rust crate needs at runtime. Both files are the
//! source-of-truth in the JS world (`launcher.ts` for the
//! defaults, `update-config.json` for the snapshot sync'd by
//! `scripts/sync-launcher-config.cjs`), so there is no Rust copy
//! to drift — every URL the Rust crate uses comes from the same
//! committed file the renderer side ships.
//!
//! # What this emits
//!
//! ```text
//! pub const UPDATE_BASE_URL: &str = "https://cdn-c.zemu.uk";
//! pub const REALTIME_URL: &str = "wss://socket.zemu.uk";
//! pub const OAUTH_CALLBACK_PROTOCOL: &str = "zemu-launcher://";
//! ```
//!
//! Rust code can override any of these at runtime via env vars
//! (`LAUNCHER_UPDATE_BASE_URL`, `LAUNCHER_REALTIME_URL`) so
//! `pnpm tauri dev` can point at local services without editing
//! committed files. Production builds have no override path.

use std::env;
use std::fs;
use std::path::PathBuf;

use regex::Regex;

fn main() {
    // Re-emit whenever any of the input sources change.
    println!("cargo:rerun-if-changed=../update-config.json");
    println!("cargo:rerun-if-changed=../src/config/launcher.ts");

    // Windows MSVC: embed a side-by-side manifest declaring
    // Microsoft.Windows.Common-Controls v6 into every linked
    // target. Without this, the linker binds comctl32 v5 and the
    // first call into a comctl6-only export (e.g.
    // TaskDialogIndirect, pulled in transitively by tao / muda
    // via Tauri's dialog code) makes the loader abort with
    // STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139) before `main` runs.
    //
    // Tauri 2's default tauri-build manifest is resource-based
    // and only attaches to `[[bin]]` targets, which leaves the
    // `cargo test` harness and any `cdylib` consumers
    // unprotected. Disabling it via `new_without_app_manifest()`
    // and embedding ours through the linker from this `build.rs`
    // covers every link invocation (app binary, test harnesses,
    // examples, dependents) in one pass and avoids the LNK1123
    // collision you get from two `/MANIFEST:EMBED` passes.
    //
    // Upstream reports: tauri-apps/tauri#13419, #13948, #14580.
    // Reference fixes in the wild:
    //   - github.com/dohooo/helmor commit 386f103
    //   - github.com/Xoshbin/asyar pull 499
    //   - github.com/Shalom-Karr/GroupMe-Windows commit d9c4c4c
    if cfg!(all(windows, target_env = "msvc")) {
        let manifest_path = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"))
            .join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest_path.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest_path.display());
    }

    // Let `tauri-build` run its non-manifest bits (icon / version
    // resource, sidecar placeholder validation, etc.) but tell it
    // to skip the resource-based app manifest so the linker-based
    // manifest above is the only one embedded. On non-Windows
    // targets `try_build` is a no-op for the manifest side, but
    // we keep it so tauri-build's other work still happens.
    tauri_build::try_build(
        tauri_build::Attributes::new().windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest()),
    )
    .expect("failed to run tauri-build");

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let update_config_path = manifest_dir.join("..").join("update-config.json");
    let launcher_ts_path = manifest_dir.join("..").join("src").join("config").join("launcher.ts");

    let update_base_url = extract_update_base_url(&update_config_path).unwrap_or_else(|err| {
        // Fall back to the bundled compile-time default rather
        // than brick a `cargo build` over a missing/garbled
        // `update-config.json`. The committed default matches
        // what `sync-launcher-config.cjs` writes.
        eprintln!(
            "[build.rs] failed to read {} ({}); falling back to https://cdn-c.zemu.uk",
            update_config_path.display(),
            err
        );
        "https://cdn-c.zemu.uk".to_string()
    });
    let realtime_url = extract_realtime_url(&launcher_ts_path).unwrap_or_else(|err| {
        eprintln!(
            "[build.rs] failed to read realtimeUrl from {} ({}); falling back to wss://socket.zemu.uk",
            launcher_ts_path.display(),
            err
        );
        "wss://socket.zemu.uk".to_string()
    });
    let oauth_callback_protocol =
        extract_oauth_callback_protocol(&launcher_ts_path).unwrap_or_else(|err| {
            eprintln!(
                "[build.rs] failed to read oauthCallbackProtocol from {} ({}); falling back to zemu-launcher://",
                launcher_ts_path.display(),
                err
            );
            "zemu-launcher://".to_string()
        });
    // API base URL — used by `auth::resolve_api_base_url` and
    // `hardware_api::api_post` when no dev env override is set.
    // The renderer-side `LAUNCHER_CONFIG.apiBaseUrl` is also
    // `https://id.zemu.uk`, so the Rust + JS defaults stay in
    // lockstep.
    let api_base_url = extract_api_base_url(&launcher_ts_path).unwrap_or_else(|err| {
        eprintln!(
            "[build.rs] failed to read apiBaseUrl from {} ({}); falling back to https://id.zemu.uk",
            launcher_ts_path.display(),
            err
        );
        "https://id.zemu.uk".to_string()
    });
    let friends_api_base_url =
        extract_friends_api_base_url(&launcher_ts_path).unwrap_or_else(|err| {
            eprintln!(
                "[build.rs] failed to read friendsApiBaseUrl from {} ({}); falling back to https://api.zemu.uk",
                launcher_ts_path.display(),
                err
            );
            "https://api.zemu.uk".to_string()
        });

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    fs::create_dir_all(&out_dir).expect("creating OUT_DIR");
    let dest = out_dir.join("config.rs");
    let body = format!(
        "// Auto-generated by build.rs. Do not modify.\n\
         // Source: {SRC_ROOT}/update-config.json + {SRC_ROOT}/src/config/launcher.ts\n\
         \n\
         /// Bundled game-update base URL. Override at runtime in\n\
         /// dev with the `LAUNCHER_UPDATE_BASE_URL` env var.\n\
         pub const UPDATE_BASE_URL: &str = {UPDATE_BASE_URL:?};\n\
         \n\
         /// Bundled Socket.IO realtime URL. Override at runtime in\n\
         /// dev with the `LAUNCHER_REALTIME_URL` env var.\n\
         pub const REALTIME_URL: &str = {REALTIME_URL:?};\n\
         \n\
         /// Bundled OAuth callback deep-link scheme. The Rust\n\
         /// `uses_loopback_callback` flag still routes Windows / Linux\n\
         /// / dev builds through the loopback HTTP server instead of\n\
         /// this scheme — it's only used on macOS in practice.\n\
         pub const OAUTH_CALLBACK_PROTOCOL: &str = {OAUTH_CALLBACK_PROTOCOL:?};\n\
         \n\
         /// Bundled Auth.js (Next.js) API base URL. Used by\n\
         /// `auth::resolve_api_base_url` and `hardware_api::api_post`\n\
         /// when no env override is set. Renderer-side default lives\n\
         /// in `LAUNCHER_CONFIG.apiBaseUrl` and is the same string.\n\
         pub const API_BASE_URL: &str = {API_BASE_URL:?};\n\
         \n\
         /// Bundled friends / stats API base URL. Used by\n\
         /// `hardware_api::api_post`. Renderer-side default lives\n\
         /// in `LAUNCHER_CONFIG.friendsApiBaseUrl` and is the same\n\
         /// string.\n\
         pub const FRIENDS_API_BASE_URL: &str = {FRIENDS_API_BASE_URL:?};\n",
        UPDATE_BASE_URL = update_base_url,
        REALTIME_URL = realtime_url,
        OAUTH_CALLBACK_PROTOCOL = oauth_callback_protocol,
        API_BASE_URL = api_base_url,
        FRIENDS_API_BASE_URL = friends_api_base_url,
        SRC_ROOT = manifest_dir.join("..").display(),
    );
    fs::write(&dest, body).expect("writing generated config.rs");
    println!("cargo:rerun-if-changed={}", dest.display());
}

fn extract_update_base_url(path: &PathBuf) -> Result<String, String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let parsed: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("invalid JSON: {e}"))?;
    parsed
        .get("updateBaseUrl")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "missing or empty `updateBaseUrl`".to_string())
}

fn extract_realtime_url(path: &PathBuf) -> Result<String, String> {
    extract_ts_string_field(path, "realtimeUrl")
}

fn extract_api_base_url(path: &PathBuf) -> Result<String, String> {
    extract_ts_string_field(path, "apiBaseUrl")
}

fn extract_friends_api_base_url(path: &PathBuf) -> Result<String, String> {
    extract_ts_string_field(path, "friendsApiBaseUrl")
}

fn extract_oauth_callback_protocol(path: &PathBuf) -> Result<String, String> {
    let raw = extract_ts_string_field(path, "oauthCallbackProtocol")?;
    // Mirror `sync-launcher-config.cjs` normalisation — the protocol
    // constant is always a scheme with `://` so callers can
    // `format!()` it directly into a callback URL.
    let scheme = raw
        .split_once("://")
        .map(|(prefix, _)| prefix)
        .unwrap_or(raw.as_str())
        .trim()
        .trim_end_matches(':')
        .trim_end_matches('/');
    if scheme.is_empty() {
        return Err("oauthCallbackProtocol is empty".to_string());
    }
    Ok(format!("{scheme}://"))
}

/// Pulls a string field out of `src/config/launcher.ts` without
/// needing a JS parser. Matches `<field>: 'value'` or
/// `<field>: "value"` at any indentation level.
fn extract_ts_string_field(path: &PathBuf, field: &str) -> Result<String, String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let pattern = format!(r#"{field}\s*:\s*['"]([^'"]+)['"]"#);
    let re = Regex::new(&pattern).map_err(|e| e.to_string())?;
    let captures = re
        .captures(&raw)
        .ok_or_else(|| format!("field `{field}` not found"))?;
    captures
        .get(1)
        .map(|m| m.as_str().trim().to_string())
        .ok_or_else(|| format!("field `{field}` had no capture group"))
}