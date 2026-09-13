use std::ffi::OsStr;
use std::process::Command;

/// Build a host command without leaking the AppImage's Python installation.
/// Keep the launcher's own environment intact (WebKit and restart need it).
pub fn command(program: impl AsRef<OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(target_os = "linux")]
    if let Some(app_dir) = std::env::var_os("APPDIR") {
        clean_python_environment(&mut command, &app_dir, std::env::vars_os());
    }
    command
}

#[cfg(target_os = "linux")]
fn clean_python_environment(
    command: &mut Command,
    app_dir: &OsStr,
    environment: impl IntoIterator<Item = (std::ffi::OsString, std::ffi::OsString)>,
) {
    let app_dir = std::path::Path::new(app_dir);
    if !app_dir.is_absolute() || app_dir.parent().is_none() {
        return;
    }

    for (key, value) in environment {
        if key != "PYTHONHOME" && key != "PYTHONPATH" {
            continue;
        }
        let paths: Vec<_> = std::env::split_paths(&value).collect();
        if !paths.iter().any(|path| path.starts_with(app_dir)) {
            continue;
        }

        // PYTHONHOME can be prefix:exec_prefix; dropping just one component
        // changes its meaning. Let the host interpreter discover its prefixes.
        if key == "PYTHONHOME" {
            command.env_remove(key);
            continue;
        }

        let retained: Vec<_> = paths
            .into_iter()
            .filter(|path| !path.starts_with(app_dir))
            .collect();
        if retained.is_empty() {
            command.env_remove(key);
        } else if let Ok(value) = std::env::join_paths(retained) {
            command.env(key, value);
        }
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use std::ffi::OsString;

    fn configured_command(program: &str, environment: &[(&str, &str)]) -> Command {
        let mut command = Command::new(program);
        command.env_clear().envs(environment.iter().copied());
        clean_python_environment(
            &mut command,
            OsStr::new("/tmp/.mount_zemu-test"),
            environment
                .iter()
                .map(|(key, value)| (OsString::from(key), OsString::from(value))),
        );
        command
    }

    #[test]
    fn host_python_starts_with_appimage_environment() {
        let output = configured_command(
            "/usr/bin/python3",
            &[
                ("PYTHONHOME", "/tmp/.mount_zemu-test/usr/"),
                ("PYTHONPATH", "/tmp/.mount_zemu-test/usr/share/pyshared/:"),
                ("WEBKIT_DISABLE_DMABUF_RENDERER", "1"),
                ("STEAM_COMPAT_DATA_PATH", "/games/prefix"),
            ],
        )
        .args([
            "-c",
            "import encodings, os; assert 'PYTHONHOME' not in os.environ; assert '.mount_zemu' not in os.environ.get('PYTHONPATH', ''); assert os.environ['WEBKIT_DISABLE_DMABUF_RENDERER'] == '1'; assert os.environ['STEAM_COMPAT_DATA_PATH'] == '/games/prefix'",
        ])
        .output()
        .expect("system Python is required for this regression test");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn preserves_user_python_paths_and_similarly_named_directories() {
        let command = configured_command(
            "python3",
            &[
                ("PYTHONHOME", "/opt/python"),
                ("PYTHONPATH", "/custom:/tmp/.mount_zemu-test/usr/share/pyshared:/tmp/.mount_zemu-test-other/modules:"),
            ],
        );
        let environment: std::collections::HashMap<_, _> = command.get_envs().collect();
        assert_eq!(
            environment[OsStr::new("PYTHONHOME")],
            Some(OsStr::new("/opt/python"))
        );
        assert_eq!(
            environment[OsStr::new("PYTHONPATH")],
            Some(OsStr::new("/custom:/tmp/.mount_zemu-test-other/modules:"))
        );
    }

    #[test]
    fn removes_bundle_only_paths_and_allows_explicit_runtime_overrides() {
        let mut command = configured_command(
            "python3",
            &[
                ("PYTHONHOME", "/opt/python:/tmp/.mount_zemu-test/usr"),
                ("PYTHONPATH", "/tmp/.mount_zemu-test/usr/share/pyshared"),
            ],
        );
        assert!(command.get_envs().all(|(_, value)| value.is_none()));
        command.env("PYTHONHOME", "/custom/python");
        assert!(
            command
                .get_envs()
                .any(|(key, value)| key == "PYTHONHOME"
                    && value == Some(OsStr::new("/custom/python")))
        );
    }
}
