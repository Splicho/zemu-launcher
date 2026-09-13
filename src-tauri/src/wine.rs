use crate::debug_log;
use crate::models::{WineConfig, WineEnvVar, WineRuntime, WineRuntimeKind};
use crate::storage::{load_launcher_config, save_launcher_config};
use anyhow::Result;
#[cfg(not(target_os = "windows"))]
use anyhow::anyhow;
use std::collections::HashSet;
#[cfg(not(target_os = "windows"))]
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
#[cfg(not(target_os = "windows"))]
use tauri::Manager;
use tauri::AppHandle;

#[cfg(not(target_os = "windows"))]
const CUSTOM_RUNTIME_ID: &str = "custom";
#[cfg(not(target_os = "windows"))]
const DEFAULT_COMPATDATA_DIR: &str = "compatdata/zemu-kotk";

#[cfg(not(target_os = "windows"))]
#[cfg(not(target_os = "windows"))]
pub struct WineLaunchCommand {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub env: Vec<(String, String)>,
    pub label: String,
}

pub fn get_config(app: &AppHandle) -> Result<WineConfig> {
    Ok(load_launcher_config(app)?.wine)
}

pub fn save_config(app: &AppHandle, config: WineConfig) -> Result<WineConfig> {
    let mut launcher_config = load_launcher_config(app)?;
    launcher_config.wine = normalize_config(config);
    save_launcher_config(app, &launcher_config)?;
    let _ = debug_log::append(
        app,
        "wine",
        &format!(
            "save_config enabled={} runtime_id={} prefix_present={} env_count={}",
            launcher_config.wine.enabled,
            launcher_config
                .wine
                .runtime_id
                .as_deref()
                .unwrap_or("<auto>"),
            launcher_config.wine.wine_prefix.is_some(),
            launcher_config.wine.env.len()
        ),
    );
    Ok(launcher_config.wine)
}

pub fn list_runtimes() -> Vec<WineRuntime> {
    let mut runtimes = Vec::new();
    let mut seen = HashSet::new();

    for name in ["wine", "wine64"] {
        if let Some(path) = executable_in_path(name) {
            push_runtime(
                &mut runtimes,
                &mut seen,
                WineRuntime {
                    id: format!("wine:{}", path.display()),
                    name: format!("{} ({})", name, path.display()),
                    kind: WineRuntimeKind::Wine,
                    version: command_version(&path),
                    path: path.to_string_lossy().to_string(),
                },
            );
        }
    }

    for dir in proton_candidate_dirs() {
        if let Some(runtime) = proton_runtime_from_dir(&dir) {
            push_runtime(&mut runtimes, &mut seen, runtime);
        }
    }

    runtimes.sort_by(|a, b| {
        let kind_rank = |kind: &WineRuntimeKind| match kind {
            WineRuntimeKind::Wine => 0,
            WineRuntimeKind::Proton => 1,
            WineRuntimeKind::Custom => 2,
        };
        kind_rank(&a.kind)
            .cmp(&kind_rank(&b.kind))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    runtimes
}

pub fn select_prefix_directory() -> Result<Option<String>> {
    let default_dir = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    Ok(rfd::FileDialog::new()
        .set_title("Select Wine prefix / Proton compatdata directory")
        .set_directory(default_dir)
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string()))
}

pub fn select_runtime_executable() -> Result<Option<String>> {
    let default_dir = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    Ok(rfd::FileDialog::new()
        .set_title("Select Wine or Proton executable")
        .set_directory(default_dir)
        .pick_file()
        .map(|path| path.to_string_lossy().to_string()))
}

#[cfg(not(target_os = "windows"))]
pub fn build_launch_command(
    app: &AppHandle,
    executable_path: &Path,
) -> Result<Option<WineLaunchCommand>> {
    let config = get_config(app)?;
    if !config.enabled {
        return Ok(None);
    }

    let runtime = resolve_runtime(&config)?;
    build_command(&config, runtime, executable_path, || {
        Ok(app.path().app_data_dir()?.join(DEFAULT_COMPATDATA_DIR))
    })
    .map(Some)
}

#[cfg(not(target_os = "windows"))]
fn build_command(
    config: &WineConfig,
    runtime: WineRuntime,
    executable_path: &Path,
    default_compatdata: impl FnOnce() -> Result<PathBuf>,
) -> Result<WineLaunchCommand> {
    let mut env = sanitized_env(&config.env);
    let mut args = Vec::new();

    let prefix = config
        .wine_prefix
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty());
    match runtime.kind {
        WineRuntimeKind::Wine | WineRuntimeKind::Custom => {
            if let Some(prefix) = prefix {
                env.push(("WINEPREFIX".to_string(), prefix.to_string()));
            }
            args.push(executable_path.as_os_str().to_os_string());
        }
        WineRuntimeKind::Proton => {
            let compatdata = match prefix {
                Some(value) => PathBuf::from(value),
                None => default_compatdata()?,
            };
            fs::create_dir_all(&compatdata)?;
            env.push((
                "STEAM_COMPAT_DATA_PATH".to_string(),
                compatdata.to_string_lossy().to_string(),
            ));
            if let Some(root) = steam_root_for_proton(&runtime.path) {
                env.push((
                    "STEAM_COMPAT_CLIENT_INSTALL_PATH".to_string(),
                    root.to_string_lossy().to_string(),
                ));
            }
            args.push(OsString::from("waitforexitandrun"));
            args.push(executable_path.as_os_str().to_os_string());
        }
    }

    Ok(WineLaunchCommand {
        program: PathBuf::from(&runtime.path),
        args,
        env,
        label: runtime.name,
    })
}

fn normalize_config(mut config: WineConfig) -> WineConfig {
    config.runtime_id = clean_optional(config.runtime_id);
    config.custom_runtime_path = clean_optional(config.custom_runtime_path);
    config.wine_prefix = clean_optional(config.wine_prefix);
    config.env = sanitized_env(&config.env)
        .into_iter()
        .map(|(key, value)| WineEnvVar { key, value })
        .collect();
    config
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn sanitized_env(env: &[WineEnvVar]) -> Vec<(String, String)> {
    env.iter()
        .filter_map(|entry| {
            let key = entry.key.trim();
            if is_valid_env_key(key) {
                Some((key.to_string(), entry.value.clone()))
            } else {
                None
            }
        })
        .collect()
}

fn is_valid_env_key(value: &str) -> bool {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) if first == '_' || first.is_ascii_alphabetic() => {}
        _ => return false,
    }
    chars.all(|c| c == '_' || c.is_ascii_alphanumeric())
}

#[cfg(not(target_os = "windows"))]
fn resolve_runtime(config: &WineConfig) -> Result<WineRuntime> {
    if config.runtime_id.as_deref() == Some(CUSTOM_RUNTIME_ID) {
        return custom_runtime(config);
    }

    let runtimes = list_runtimes();
    if let Some(runtime_id) = config.runtime_id.as_deref() {
        return runtimes
            .into_iter()
            .find(|runtime| runtime.id == runtime_id)
            .ok_or_else(|| anyhow!("Selected Wine/Proton runtime is no longer available. Choose another runtime in Properties."));
    }

    runtimes
        .into_iter()
        .next()
        .or_else(|| custom_runtime(config).ok())
        .ok_or_else(|| anyhow!("No Wine or Proton runtime found"))
}

#[cfg(not(target_os = "windows"))]
fn custom_runtime(config: &WineConfig) -> Result<WineRuntime> {
    let path = config
        .custom_runtime_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow!("Custom Wine/Proton executable is not configured"))?;

    Ok(WineRuntime {
        id: CUSTOM_RUNTIME_ID.to_string(),
        name: format!("Custom ({path})"),
        kind: if Path::new(path)
            .file_name()
            .is_some_and(|name| name.eq_ignore_ascii_case("proton"))
        {
            WineRuntimeKind::Proton
        } else {
            WineRuntimeKind::Custom
        },
        path: path.to_string(),
        version: None,
    })
}

fn push_runtime(runtimes: &mut Vec<WineRuntime>, seen: &mut HashSet<String>, runtime: WineRuntime) {
    if seen.insert(runtime.path.clone()) {
        runtimes.push(runtime);
    }
}

fn executable_in_path(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn command_version(path: &Path) -> Option<String> {
    let output = Command::new(path).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn proton_candidate_dirs() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for root in steam_roots() {
        for parent in [
            root.join("steamapps/common"),
            root.join("compatibilitytools.d"),
            root.join("steamapps/compatibilitytools.d"),
        ] {
            if let Ok(entries) = fs::read_dir(parent) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        candidates.push(path);
                    }
                }
            }
        }
    }
    candidates
}

fn proton_runtime_from_dir(dir: &Path) -> Option<WineRuntime> {
    let proton = dir.join("proton");
    if !proton.is_file() {
        return None;
    }

    let dir_name = dir.file_name()?.to_string_lossy().to_string();
    let lower = dir_name.to_lowercase();
    if !lower.contains("proton") {
        return None;
    }

    Some(WineRuntime {
        id: format!("proton:{}", proton.display()),
        name: dir_name.clone(),
        kind: WineRuntimeKind::Proton,
        path: proton.to_string_lossy().to_string(),
        version: Some(dir_name),
    })
}

fn steam_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join(".steam/steam"));
        roots.push(home.join(".local/share/Steam"));
        roots.push(home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"));
    }
    roots
}

#[cfg(not(target_os = "windows"))]
fn steam_root_for_proton(path: &str) -> Option<PathBuf> {
    let proton_path = Path::new(path);
    for root in steam_roots() {
        if proton_path.starts_with(&root) {
            return Some(root);
        }
    }
    None
}

#[cfg(all(test, not(target_os = "windows")))]
mod tests {
    use super::*;

    fn runtime(kind: WineRuntimeKind) -> WineRuntime {
        WineRuntime {
            id: "test".into(),
            name: "Test runtime".into(),
            kind,
            path: "/opt/runtime with spaces/wine".into(),
            version: None,
        }
    }

    #[test]
    fn wine_preserves_arguments_and_prefix_with_spaces() {
        let config = WineConfig {
            wine_prefix: Some("/games/my prefix".into()),
            env: vec![WineEnvVar {
                key: "DXVK_ASYNC".into(),
                value: "1".into(),
            }],
            ..Default::default()
        };
        let executable = Path::new("/games/King of the Kill/H1Z1.exe");
        let launch = build_command(&config, runtime(WineRuntimeKind::Wine), executable, || {
            panic!("Wine does not need Proton compatdata")
        })
        .unwrap();
        assert_eq!(launch.args, vec![executable.as_os_str()]);
        assert!(launch
            .env
            .contains(&("WINEPREFIX".into(), "/games/my prefix".into())));
        assert!(launch.env.contains(&("DXVK_ASYNC".into(), "1".into())));
    }

    #[test]
    fn wine_inside_a_proton_distribution_is_not_the_proton_script() {
        for (path, expected) in [
            ("/opt/GE-Proton/files/bin/wine", WineRuntimeKind::Custom),
            ("/opt/GE-Proton/proton", WineRuntimeKind::Proton),
        ] {
            let config = WineConfig {
                runtime_id: Some(CUSTOM_RUNTIME_ID.into()),
                custom_runtime_path: Some(path.into()),
                ..Default::default()
            };
            assert_eq!(custom_runtime(&config).unwrap().kind, expected);
        }
    }

    #[test]
    fn proton_creates_default_or_selected_compatdata_and_waits_for_game() {
        let root = std::env::temp_dir().join(format!("zemu-proton-{}", rand::random::<u64>()));
        for explicit in [false, true] {
            let prefix = root.join(if explicit {
                "custom prefix"
            } else {
                "default prefix"
            });
            let config = WineConfig {
                wine_prefix: explicit.then(|| prefix.to_string_lossy().into_owned()),
                ..Default::default()
            };
            let launch = build_command(
                &config,
                runtime(WineRuntimeKind::Proton),
                Path::new("/game/H1Z1.exe"),
                || {
                    assert!(!explicit);
                    Ok(prefix.clone())
                },
            )
            .unwrap();
            assert!(prefix.is_dir());
            assert_eq!(launch.args, vec!["waitforexitandrun", "/game/H1Z1.exe"]);
            assert!(launch.env.contains(&(
                "STEAM_COMPAT_DATA_PATH".into(),
                prefix.to_string_lossy().into_owned()
            )));
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn compatibility_process_receives_arguments_without_touching_client_config() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("zemu-cli-{}", rand::random::<u64>()));
        fs::create_dir_all(&root).unwrap();
        let ini = root.join("ClientConfig.ini");
        let original = "server=example.invalid\r\nSessionId=old\r\nCasSessionId=keep\r\n";
        let fake = root.join("fake runtime");
        fs::write(&fake, "#!/bin/sh\nprintf '%s\\n' \"$@\"\n").unwrap();
        fs::set_permissions(&fake, fs::Permissions::from_mode(0o700)).unwrap();
        let executable = root.join("H1Z1.exe");
        let client_args = crate::launch_args::client_arguments("test key 'quoted' $(literal)");
        for kind in [WineRuntimeKind::Wine, WineRuntimeKind::Proton] {
            let mut runtime = runtime(kind.clone());
            runtime.path = fake.to_string_lossy().into_owned();
            let config = WineConfig {
                wine_prefix: Some(root.join("prefix").to_string_lossy().into_owned()),
                ..Default::default()
            };
            let launch = build_command(&config, runtime, &executable, || unreachable!()).unwrap();
            let mut expected = vec![];
            if kind == WineRuntimeKind::Proton {
                expected.push("waitforexitandrun".to_string());
            }
            expected.push(executable.to_string_lossy().into_owned());
            expected.extend(client_args.iter().cloned());
            for existing in [false, true] {
                if existing {
                    fs::write(&ini, original).unwrap();
                }
                let output = Command::new(&launch.program)
                    .args(&launch.args)
                    .args(&client_args)
                    .envs(launch.env.iter().cloned())
                    .current_dir(&root)
                    .output()
                    .unwrap();
                assert!(output.status.success());
                assert_eq!(
                    String::from_utf8(output.stdout).unwrap(),
                    format!("{}\n", expected.join("\n"))
                );
                if existing {
                    assert_eq!(fs::read_to_string(&ini).unwrap(), original);
                    fs::remove_file(&ini).unwrap();
                } else {
                    assert!(!ini.exists());
                }
            }
        }
        fs::remove_dir_all(root).unwrap();
    }
}
