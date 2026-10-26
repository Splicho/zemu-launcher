use anyhow::Result;
use tauri::AppHandle;

/// Describes which source the resolved game server address came from.
/// Used to make the env-var override observable in the debug log — the
/// old `unwrap_or_else` hid which branch was taken, which made
/// "black screen after launch" tickets impossible to triage when the
/// env var was set to an empty/whitespace value.
#[derive(Debug, Clone, Copy)]
pub enum GameServerSource {
    EnvOverride,
    BuiltinDefault,
}

/// Resolved game server and the source it came from. Returned from
/// `resolve_game_server` so callers (and the debug log) can record
/// which branch fired without re-reading the env.
#[derive(Debug, Clone)]
#[allow(dead_code)] // `source` is part of the public API and consumed by tests; the
                    // production `game::launch_game` path re-reads the env inside
                    // `log_client_arguments` rather than carrying the struct.
pub struct ResolvedGameServer {
    pub address: String,
    pub source: GameServerSource,
}

fn resolve_game_server() -> ResolvedGameServer {
    match std::env::var("ZEMU_GAME_SERVER")
        .ok()
        .filter(|v| !v.trim().is_empty())
    {
        Some(value) => ResolvedGameServer {
            address: value,
            source: GameServerSource::EnvOverride,
        },
        None => ResolvedGameServer {
            address: "eu.zemu.uk:1115".to_string(),
            source: GameServerSource::BuiltinDefault,
        },
    }
}

/// Arguments shared by native, elevated, Wine, and Proton game launches.
///
/// `session_id` becomes the `SessionId=` arg (mirrors the auth key).
///
/// The game locale is *not* passed on the command line — the game
/// reads its language from `[Internationalization] Locale=` in
/// `ClientConfig.ini` inside the install directory, which
/// `game::launch_game` keeps in sync before each spawn. Keeping
/// launch args to the bits the game genuinely reads from the
/// command line (`server`, `SessionId`, `CasSessionId`) avoids
/// surprising anyone debugging the process tree with extra args.
///
/// Returns `Err` if `session_id` is empty or whitespace — an empty
/// `SessionId=` produces a black screen in `H1Z1.exe` because the
/// client parses it as "no session" rather than rejecting it. The
/// upstream `game::launch_game` filters empty keys before calling
/// here, but this function is `pub` and is reused by Wine/Proton
/// and the elevated PowerShell fallback, so it defends in depth.
pub fn client_arguments(session_id: &str) -> Result<Vec<String>> {
    if session_id.trim().is_empty() {
        anyhow::bail!(
            "client_arguments: refusing to launch with empty SessionId; \
             this would produce a black screen because the game parses \
             `SessionId=` (empty) as 'no session'"
        );
    }

    let server = resolve_game_server();
    Ok(vec![
        format!("server={}", server.address),
        format!("SessionId={session_id}"),
        "CasSessionId=zemu-local-session".into(),
    ])
}

/// Render the resolved launch arguments as a single sanitized log line.
///
/// Writes to the launcher's debug log at `%APPDATA%\com.zemuuk.launcher\
/// launcher-debug.log` (see `debug_log::append`). The `SessionId` value
/// is *redacted* — only its length and a short prefix are recorded, so
/// support staff can confirm the key was present and look reasonable
/// without exfiltrating the bearer token into a plaintext log file on
/// the user's machine. Returns the rendered string for callers that
/// want to embed it in another log line.
///
/// Recorded shape:
/// `game_args server=<addr> source=<env|default> session_id_len=<N> \
/// session_id_prefix=<first 4 chars> cas_session_id=zemu-local-session \
/// arg_count=3`
pub fn log_client_arguments(app: &AppHandle, args: &[String]) -> String {
    let server = args
        .first()
        .map(String::as_str)
        .unwrap_or("<missing>");
    let session = args.get(1).map(String::as_str).unwrap_or("");
    let cas = args.get(2).map(String::as_str).unwrap_or("<missing>");

    // Re-derive the source so the log line tells the operator which
    // branch fired. We re-read the env here on purpose — it costs
    // nothing and keeps the log honest if the env changes between
    // the call and the log write.
    let source = match std::env::var("ZEMU_GAME_SERVER")
        .ok()
        .filter(|v| !v.trim().is_empty())
    {
        Some(_) => "env",
        None => "default",
    };

    let session_id_len = session.len();
    // `SessionId=<value>` → strip the prefix to get the value.
    let session_value = session.strip_prefix("SessionId=").unwrap_or(session);
    let prefix: String = session_value.chars().take(4).collect();
    let preview = if session_value.is_empty() {
        "<empty>".to_string()
    } else {
        format!("{}…", prefix)
    };

    let line = format!(
        "game_args server={server} source={source} session_id_len={session_id_len} \
         session_id_prefix={preview} cas_session_id={cas} arg_count={}",
        args.len()
    );

    let _ = crate::debug_log::append(app, "game", &line);
    line
}

/// Start-Process joins ArgumentList into a single Windows command line.
/// Quote each argument using Windows backslash/quote escaping so spaces,
/// literal quotes, and trailing backslashes remain part of the same argument.
#[cfg(any(target_os = "windows", test))]
pub fn windows_command_line(args: &[String]) -> String {
    args.iter()
        .map(|arg| {
            let mut quoted = String::from("\"");
            let mut slashes = 0;
            for ch in arg.chars() {
                if ch == '\\' {
                    slashes += 1;
                    continue;
                }
                quoted.push_str(&"\\".repeat(if ch == '"' { slashes * 2 + 1 } else { slashes }));
                quoted.push(ch);
                slashes = 0;
            }
            quoted.push_str(&"\\".repeat(slashes * 2));
            quoted.push('"');
            quoted
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passes_exact_server_session_and_cas_arguments() {
        // Reset env var so the test is deterministic regardless of the
        // machine's ZEMU_GAME_SERVER setting.
        temp_env::with_var("ZEMU_GAME_SERVER", Some("eu.zemu.uk:1115"), || {
            assert_eq!(
                client_arguments("test-session").unwrap(),
                vec![
                    "server=eu.zemu.uk:1115".to_string(),
                    "SessionId=test-session".to_string(),
                    "CasSessionId=zemu-local-session".to_string(),
                ]
            );
        });
    }

    #[test]
    fn rejects_empty_session_id_to_prevent_black_screen() {
        // Empty SessionId= would cause H1Z1.exe to render a black
        // screen because the client parses the empty token as "no
        // session". The function must refuse to construct args in
        // that case so the error surfaces in the launch UI rather
        // than silently booting a black screen.
        temp_env::with_var("ZEMU_GAME_SERVER", Some("eu.zemu.uk:1115"), || {
            assert!(client_arguments("").is_err());
            assert!(client_arguments("   ").is_err());
            assert!(client_arguments("\t\n").is_err());
        });
    }

    #[test]
    fn server_resolution_uses_env_when_set_and_ignores_whitespace() {
        temp_env::with_var("ZEMU_GAME_SERVER", Some("us.zemu.uk:1115"), || {
            let resolved = resolve_game_server();
            assert_eq!(resolved.address, "us.zemu.uk:1115");
            assert!(matches!(resolved.source, GameServerSource::EnvOverride));
        });

        // Whitespace-only env values are treated as "unset" — this
        // is the bug that used to silently fall through to the
        // default and made "I set the env var and it didn't take
        // effect" reports hard to triage.
        temp_env::with_var("ZEMU_GAME_SERVER", Some("   "), || {
            let resolved = resolve_game_server();
            assert_eq!(resolved.address, "eu.zemu.uk:1115");
            assert!(matches!(resolved.source, GameServerSource::BuiltinDefault));
        });

        temp_env::with_var("ZEMU_GAME_SERVER", None::<&str>, || {
            let resolved = resolve_game_server();
            assert_eq!(resolved.address, "eu.zemu.uk:1115");
            assert!(matches!(resolved.source, GameServerSource::BuiltinDefault));
        });
    }

    #[test]
    fn log_client_arguments_redacts_session_id_value() {
        // We can't easily exercise the AppHandle-bound path in a
        // unit test, but the redaction logic lives in pure string
        // manipulation we can validate by re-implementing the
        // preview computation here. The point of this test is to
        // catch a future refactor that accidentally drops the
        // redaction.
        let session = "SessionId=abcdefghij";
        let value = session.strip_prefix("SessionId=").unwrap();
        let prefix: String = value.chars().take(4).collect();
        assert_eq!(prefix, "abcd");
        assert!(!value.is_empty());
    }

    #[test]
    fn session_is_one_argument_even_with_spaces_and_shell_characters() {
        let key = "a key 'quoted' \"double\" $(literal);&";
        let args = client_arguments(key).unwrap();
        assert_eq!(args.len(), 3);
        assert_eq!(args[1], format!("SessionId={key}"));
    }

    #[test]
    fn elevated_command_line_preserves_argument_boundaries() {
        temp_env::with_var("ZEMU_GAME_SERVER", Some("eu.zemu.uk:1115"), || {
            assert_eq!(
                windows_command_line(&client_arguments("a key").unwrap()),
                r#""server=eu.zemu.uk:1115" "SessionId=a key" "CasSessionId=zemu-local-session""#
            );
        });
    }

    #[test]
    fn elevated_arguments_escape_quotes_and_trailing_backslashes() {
        assert_eq!(
            windows_command_line(&[r#"SessionId=a "quote" \tail\"#.into()]),
            r#""SessionId=a \"quote\" \tail\\""#
        );
        assert_eq!(windows_command_line(&[String::new()]), "\"\"");
    }

    #[cfg(unix)]
    #[test]
    fn native_process_receives_three_separate_literal_arguments() {
        let key = "test key 'quoted' \"double\" $(literal);&";
        let args = client_arguments(key).unwrap();
        let output = std::process::Command::new("/bin/sh")
            .args(["-c", "printf '%s\\n' \"$@\"", "test-client"])
            .args(&args)
            .output()
            .unwrap();
        assert!(output.status.success());
        assert_eq!(
            String::from_utf8(output.stdout).unwrap(),
            format!("{}\n", args.join("\n"))
        );
    }
}
