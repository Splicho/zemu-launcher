/// Arguments shared by native, elevated, Wine, and Proton game launches.
pub fn client_arguments(session_id: &str) -> [String; 3] {
    [
        "server=eu.zemu.uk:1115".into(),
        format!("SessionId={session_id}"),
        "CasSessionId=zemu-local-session".into(),
    ]
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
        assert_eq!(
            client_arguments("test-session"),
            [
                "server=eu.zemu.uk:1115",
                "SessionId=test-session",
                "CasSessionId=zemu-local-session",
            ]
        );
    }

    #[test]
    fn session_is_one_argument_even_with_spaces_and_shell_characters() {
        let key = "a key 'quoted' \"double\" $(literal);&";
        let args = client_arguments(key);
        assert_eq!(args.len(), 3);
        assert_eq!(args[1], format!("SessionId={key}"));
    }

    #[test]
    fn elevated_command_line_preserves_argument_boundaries() {
        assert_eq!(
            windows_command_line(&client_arguments("a key")),
            r#""server=eu.zemu.uk:1115" "SessionId=a key" "CasSessionId=zemu-local-session""#
        );
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
        let args = client_arguments(key);
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
