//! Steam install detection.
//!
//! Locates the user's Steam installation on disk so the React
//! renderer can present a fully-qualified path for the depot
//! download (the `app_433850/depot_433851` folder the user needs
//! to point the launcher at).
//!
//! Lookup strategy, in order of reliability:
//!
//! 1. **Windows registry** — `HKLM\SOFTWARE\WOW6432Node\Valve\Steam`
//!    value `InstallPath`. Steam writes this on every install/repair
//!    and it's the canonical source of truth on Windows.
//! 2. **Common Windows fallbacks** — probe the two default install
//!    locations (`C:\Program Files (x86)\Steam` and
//!    `C:\Program Files\Steam`). Covers the rare case where the
//!    registry key was wiped but the install is still intact.
//! 3. **macOS / Linux fallbacks** — `~/Library/Application Support/Steam`
//!    and `~/.steam/steam` respectively. Cheap to probe.
//!
//! Returns the **full absolute path** of the depot download folder
//! (`<steam_root>/steamapps/content/app_<APP_ID>/depot_<DEPOT_ID>/`)
//! — the renderer just displays and copies it, no path joining on
//! the JS side. Native path separators are preserved so the
//! resulting string round-trips cleanly through clipboard /
//! File Explorer / Steam itself.
//!
//! Failures (no registry key, no Steam at all) return `None`. The
//! caller is expected to silently fall back to the generic
//! `steamapps/content/...` hint — never show a "could not detect
//! Steam" error to the user, that just adds noise.

use std::path::{Path, PathBuf};

/// App ID for H1Z1: King of the Kill on Steam. Hardcoded for the
/// single-purpose nature of this launcher; if a second game is
/// ever supported, expose these as command arguments instead.
const STEAM_APP_ID: u32 = 433_850;
/// Depot ID within the H1Z1 app that contains the base game files
/// downloadable from Steam's depot console.
const STEAM_DEPOT_ID: u32 = 433_851;

/// Returns the absolute path of the folder where SteamCMD/Steam's
/// depot console will deposit the downloaded game files, or `None`
/// if no Steam installation can be located.
///
/// The returned path always ends with the native path separator
/// (matching `std::path::MAIN_SEPARATOR`) so concatenation with
/// relative paths produces a valid absolute path on every OS.
pub fn detect_kotk_depot_path() -> Option<String> {
    let steam_root = detect_steam_install()?;
    Some(join_depot_suffix(&steam_root))
}

/// Locate the Steam install root and return it as a `PathBuf`, or
/// `None` if no install was found. Exposed for callers that want
/// the bare install path rather than the depot-specific path.
pub fn detect_steam_install() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        if let Some(path) = detect_steam_install_windows_registry() {
            return Some(path);
        }
        if let Some(path) = detect_steam_install_windows_common_paths() {
            return Some(path);
        }
        None
    }

    #[cfg(target_os = "macos")]
    {
        detect_steam_install_macos()
    }

    #[cfg(target_os = "linux")]
    {
        detect_steam_install_linux()
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        None
    }
}

/// Append the depot-relative suffix (`steamapps/content/app_X/depot_Y/`).
/// Uses `MAIN_SEPARATOR` so the result matches what users will see
/// in File Explorer / their shell.
fn join_depot_suffix(steam_root: &Path) -> String {
    let suffix = format!(
        "steamapps{sep}content{sep}app_{app}{sep}depot_{depot}{sep}",
        sep = std::path::MAIN_SEPARATOR,
        app = STEAM_APP_ID,
        depot = STEAM_DEPOT_ID,
    );
    steam_root.join(suffix).to_string_lossy().into_owned()
}

#[cfg(target_os = "windows")]
fn detect_steam_install_windows_registry() -> Option<PathBuf> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    // Steam installs as a 32-bit app on 64-bit Windows, so the
    // registry hive is `WOW6432Node`. Reading `HKLM` is allowed
    // for any user without UAC; the only failure modes are
    // `NotFound` (no Steam installed) or permission denied on
    // heavily locked-down systems. Both are non-fatal — fall
    // through to the common-path probe.
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let steam_key = hklm
        .open_subkey(r"SOFTWARE\WOW6432Node\Valve\Steam")
        .ok()?;
    let install_path: String = steam_key.get_value("InstallPath").ok()?;
    let path = PathBuf::from(install_path.trim());

    // Sanity check: Steam must actually live there. `InstallPath`
    // can linger after a Steam uninstall in rare cases (manual
    // registry edit, broken uninstaller, etc.). If `steam.exe`
    // isn't in the directory, treat as "not installed".
    if !path.join("steam.exe").exists() {
        return None;
    }
    Some(path)
}

#[cfg(target_os = "windows")]
fn detect_steam_install_windows_common_paths() -> Option<PathBuf> {
    // Two defaults that cover ~99% of Windows installs. Probe in
    // order of how often each is the actual install: 32-bit
    // (Program Files (x86)) is the historical default; 64-bit
    // (Program Files) became available in recent Steam releases.
    const CANDIDATES: &[&str] = &[
        r"C:\Program Files (x86)\Steam",
        r"C:\Program Files\Steam",
    ];
    for candidate in CANDIDATES {
        let path = PathBuf::from(candidate);
        if path.join("steam.exe").exists() {
            return Some(path);
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn detect_steam_install_macos() -> Option<PathBuf> {
    // `~/Library/Application Support/Steam` is where the official
    // macOS client installs. We don't need to check for the
    // binary — the directory itself is a reliable sentinel.
    let home = std::env::var_os("HOME")?;
    let path = PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("Steam");
    if path.is_dir() {
        Some(path)
    } else {
        None
    }
}

#[cfg(target_os = "linux")]
fn detect_steam_install_linux() -> Option<PathBuf> {
    // Two reasonable defaults for Linux: the Flatpak/Snap install
    // (which lives in `~/.steam/steam`) and the native Steam
    // install (which usually installs to `~/.steam` itself or
    // `~/.local/share/Steam`). Either way, `~/.steam/steam` is the
    // canonical runtime location after Steam has booted at least
    // once.
    let home = std::env::var_os("HOME")?;
    let path = PathBuf::from(home).join(".steam").join("steam");
    if path.is_dir() {
        Some(path)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_depot_suffix_uses_native_separator() {
        let result = join_depot_suffix(Path::new("/tmp/Steam"));
        // Should contain the relative suffix with the same separator
        // style as the OS we're running tests on.
        assert!(
            result.ends_with(&format!(
                "steamapps{}content{}app_{}{}depot_{}{}",
                std::path::MAIN_SEPARATOR,
                std::path::MAIN_SEPARATOR,
                STEAM_APP_ID,
                std::path::MAIN_SEPARATOR,
                STEAM_DEPOT_ID,
                std::path::MAIN_SEPARATOR,
            )),
            "unexpected suffix in {result:?}"
        );
    }

    #[test]
    fn join_depot_suffix_round_trips() {
        let result = join_depot_suffix(Path::new("/tmp/Steam"));
        // The result must be parseable as a path and the last three
        // components must be `steamapps`, `content`, `app_<id>`,
        // `depot_<id>`.
        let p = PathBuf::from(&result);
        let components: Vec<_> = p
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect();
        let n = components.len();
        assert!(n >= 4, "expected at least 4 components, got {n}");
        assert_eq!(components[n - 4], "steamapps");
        assert_eq!(components[n - 3], "content");
        assert_eq!(components[n - 2], format!("app_{STEAM_APP_ID}"));
        assert_eq!(components[n - 1], format!("depot_{STEAM_DEPOT_ID}"));
    }
}
