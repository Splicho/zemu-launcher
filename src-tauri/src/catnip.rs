//! Surgical edit for the ZEmu anti-cheat's `catnip-client.cfg`.
//!
//! `CatnipAC.exe` sits next to `H1Z1.exe` in the game directory and
//! reads this file at startup. The launcher owns exactly two keys in
//! it:
//!
//! - `auth_key` — the user's session key.
//! - `allow_insecure_http` — the anti-cheat server is reached over
//!   plain HTTP during the testing phase, and the client defaults
//!   this to false, so the key has to be present for the client to
//!   reach the server at all.
//!
//! Everything else in the file belongs to the user (`server_url`,
//! `server_key`, `admission_ticket`, `game_path`, …) and is passed
//! through byte-for-byte. The shipped template looks like this:
//!
//! ```text
//! # ZEmu anti-cheat (Catnip) - put this file and CatnipAC.exe in your H1Z1 ...
//! # Your auth key: the same one in your LAUNCHGAME.bat (SessionId=...). Replace the placeholder.
//! auth_key = <your auth key here>
//!
//! # The ZEmu anti-cheat server is reached over plain HTTP for now (testing phase):
//! allow_insecure_http = true
//! ```
//!
//! We deliberately don't pull in an INI parsing crate just to update
//! two keys — same reasoning as `client_config.rs`: a full parser
//! would risk reformatting lines the anti-cheat cares about, and the
//! surface we need is tiny.
//!
//! Note that this file holds the auth key in cleartext. That is
//! inherent to the anti-cheat's design — it reads the key from
//! disk — but it means the launcher must never treat this file as a
//! secret store, never upload it, and never sync it anywhere.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

/// Name of the anti-cheat executable. Expected next to the game exe.
pub const CATNIP_EXECUTABLE: &str = "CatnipAC.exe";

/// Name of the anti-cheat's config file. Same directory as the exe.
pub const CATNIP_CONFIG: &str = "catnip-client.cfg";

/// Key we own: the user's session key.
const KEY_AUTH_KEY: &str = "auth_key";

/// Key we own: whether the client may talk plain HTTP to the
/// anti-cheat server. The server is plain HTTP during the testing
/// phase, so this is `true`.
const KEY_ALLOW_INSECURE_HTTP: &str = "allow_insecure_http";

/// Value written for [`KEY_ALLOW_INSECURE_HTTP`].
const ALLOW_INSECURE_HTTP: &str = "true";

/// Path of `CatnipAC.exe` inside `game_directory`.
///
/// Returns `None` when the anti-cheat is not installed — the caller
/// then falls back to launching the game directly.
///
/// On Linux/macOS the `.exe` is run through Wine/Proton.
pub fn executable_path(game_directory: &Path) -> Option<PathBuf> {
    let candidate = game_directory.join(CATNIP_EXECUTABLE);
    if candidate.is_file() {
        Some(candidate)
    } else {
        None
    }
}

/// Path of `catnip-client.cfg` inside `game_directory`.
pub fn config_path(game_directory: &Path) -> PathBuf {
    game_directory.join(CATNIP_CONFIG)
}

/// Write `auth_key` into the anti-cheat's config file at `path`.
///
/// Sets `auth_key` and `allow_insecure_http`; leaves every other line
/// untouched. A missing key is appended, an existing one is replaced
/// in place. When neither key changes, the file is not written at all
/// so the mtime doesn't churn on every launch.
///
/// Errors when the key contains a line terminator — that would
/// silently corrupt the file by injecting a bogus config line.
pub fn write_config(path: &Path, auth_key: &str) -> Result<()> {
    let auth_key = auth_key.trim();
    if auth_key.is_empty() {
        anyhow::bail!("refusing to write an empty auth key to {}", path.display());
    }
    if auth_key.contains('\n') || auth_key.contains('\r') {
        anyhow::bail!(
            "refusing to write an auth key containing a line terminator to {}",
            path.display()
        );
    }

    let original = if path.exists() {
        fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?
    } else {
        String::new()
    };

    let updated = apply_keys(&original, auth_key);
    if updated == original {
        // No change — skip the write so we don't bump mtime /
        // trigger filesystem watchers for nothing.
        return Ok(());
    }

    fs::write(path, updated).with_context(|| format!("write {}", path.display()))?;
    Ok(())
}

/// Pure transformation: given the full config file contents, return
/// the new contents with `auth_key` and `allow_insecure_http` set.
/// Exposed for unit testing.
fn apply_keys(contents: &str, auth_key: &str) -> String {
    let (line_ending, body) = detect_line_ending(contents);

    // A file that ended with a newline stays that way; an empty file
    // is treated as "should end with a newline" so a freshly created
    // config is well-formed.
    let ends_with_newline = body.ends_with('\n') || body.is_empty();

    // Split into lines. Drop a single trailing empty entry if the
    // body ended with a newline, so the line count reflects "real"
    // lines (not a sentinel for the trailing terminator).
    let mut lines: Vec<String> = if body.is_empty() {
        Vec::new()
    } else {
        body.split('\n')
            .map(|raw| raw.strip_suffix('\r').unwrap_or(raw).to_string())
            .collect()
    };
    if lines.last().map(|line| line.is_empty()).unwrap_or(false) {
        lines.pop();
    }

    let mut seen_auth_key = false;
    let mut seen_allow_insecure_http = false;

    for line in lines.iter_mut() {
        let trimmed = line.trim_start();
        // Comment lines are not keys — leave them exactly as they are.
        if trimmed.starts_with('#') || trimmed.starts_with(';') {
            continue;
        }
        let Some((key, _value)) = line.split_once('=') else {
            continue;
        };
        match key.trim() {
            KEY_AUTH_KEY => {
                *line = format!("{KEY_AUTH_KEY} = {auth_key}");
                seen_auth_key = true;
            }
            KEY_ALLOW_INSECURE_HTTP => {
                *line = format!("{KEY_ALLOW_INSECURE_HTTP} = {ALLOW_INSECURE_HTTP}");
                seen_allow_insecure_http = true;
            }
            _ => {}
        }
    }

    if !seen_auth_key {
        lines.push(format!("{KEY_AUTH_KEY} = {auth_key}"));
    }
    if !seen_allow_insecure_http {
        lines.push(format!("{KEY_ALLOW_INSECURE_HTTP} = {ALLOW_INSECURE_HTTP}"));
    }

    let mut out = lines.join(&line_ending);
    if ends_with_newline && !out.ends_with(&line_ending) {
        out.push_str(&line_ending);
    }
    out
}

/// Detect whether the file uses `\r\n` or `\n` line endings.
/// Returns the separator and the body.
///
/// A UTF-8 BOM is stripped from the body: `char::is_whitespace` does not
/// consider U+FEFF whitespace, so without this a file saved by an editor
/// as "UTF-8 with BOM" would present its first key as
/// `\u{feff}auth_key` — the writer would fail to match it, append a
/// second `auth_key` line, and leave the stale value first for Catnip to
/// read.
fn detect_line_ending(contents: &str) -> (String, String) {
    let contents = contents.strip_prefix('\u{feff}').unwrap_or(contents);
    if contents.contains("\r\n") {
        ("\r\n".to_string(), contents.to_string())
    } else {
        ("\n".to_string(), contents.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_file_gets_both_keys() {
        let out = apply_keys("", "abc123");
        assert_eq!(out, "auth_key = abc123\nallow_insecure_http = true\n");
    }

    #[test]
    fn replaces_placeholder_in_shipped_template() {
        let input = "# ZEmu anti-cheat (Catnip)\n# Your auth key: replace the placeholder.\nauth_key = <your auth key here>\n\n# plain HTTP for now:\nallow_insecure_http = true\n";
        let out = apply_keys(input, "abc123");
        assert_eq!(
            out,
            "# ZEmu anti-cheat (Catnip)\n# Your auth key: replace the placeholder.\nauth_key = abc123\n\n# plain HTTP for now:\nallow_insecure_http = true\n"
        );
    }

    #[test]
    fn preserves_foreign_keys_and_comments() {
        let input =
            "# ZEmu anti-cheat\nserver_url = http://example.com\nserver_key = k\nauth_key = old\n";
        let out = apply_keys(input, "new");
        assert_eq!(
            out,
            "# ZEmu anti-cheat\nserver_url = http://example.com\nserver_key = k\nauth_key = new\nallow_insecure_http = true\n"
        );
    }

    #[test]
    fn semicolon_comments_are_left_alone() {
        let input = "; a note = not a key\nauth_key = old\n";
        let out = apply_keys(input, "new");
        assert_eq!(
            out,
            "; a note = not a key\nauth_key = new\nallow_insecure_http = true\n"
        );
    }

    #[test]
    fn preserves_crlf_line_endings() {
        let input = "auth_key = old\r\nother = 1\r\n";
        let out = apply_keys(input, "new");
        assert_eq!(
            out,
            "auth_key = new\r\nother = 1\r\nallow_insecure_http = true\r\n"
        );
    }

    #[test]
    fn file_without_trailing_newline_stays_that_way() {
        let input = "auth_key = old";
        let out = apply_keys(input, "new");
        assert_eq!(out, "auth_key = new\nallow_insecure_http = true");
    }

    #[test]
    fn allow_insecure_http_is_forced_true() {
        let input = "allow_insecure_http = false\n";
        let out = apply_keys(input, "new");
        assert!(out.contains("allow_insecure_http = true"));
        assert!(!out.contains("false"));
    }

    #[test]
    fn writing_the_same_key_twice_is_a_no_op() {
        let input = "auth_key = abc\nallow_insecure_http = true\n";
        let out = apply_keys(input, "abc");
        assert_eq!(out, input);
    }

    #[test]
    fn value_may_contain_equals_signs() {
        let input = "auth_key = old\n";
        let out = apply_keys(input, "a=b=c");
        assert_eq!(out, "auth_key = a=b=c\nallow_insecure_http = true\n");
    }

    #[test]
    fn key_without_spaces_around_equals_is_matched() {
        let input = "auth_key=old\n";
        let out = apply_keys(input, "new");
        assert_eq!(out, "auth_key = new\nallow_insecure_http = true\n");
    }

    #[test]
    fn bom_prefixed_key_is_replaced_not_duplicated() {
        // A cfg saved as "UTF-8 with BOM" used to leave the old key as the
        // first `auth_key` line and append the new one below it, so Catnip
        // (which reads the first match) kept using the stale key.
        let input = "\u{feff}auth_key = old\nallow_insecure_http = true\n";
        let out = apply_keys(input, "new");
        assert_eq!(out, "auth_key = new\nallow_insecure_http = true\n");
        assert_eq!(out.matches("auth_key").count(), 1);
    }

    #[test]
    fn write_config_rejects_empty_key() {
        let dir =
            std::env::temp_dir().join(format!("zemu-catnip-test-empty-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let path = dir.join(CATNIP_CONFIG);
        assert!(write_config(&path, "   ").is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_config_rejects_key_with_line_terminator() {
        let dir =
            std::env::temp_dir().join(format!("zemu-catnip-test-newline-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let path = dir.join(CATNIP_CONFIG);
        assert!(write_config(&path, "abc\ndef").is_err());
        assert!(
            !path.exists(),
            "no file should be written for a rejected key"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_config_round_trips_through_disk() {
        let dir =
            std::env::temp_dir().join(format!("zemu-catnip-test-roundtrip-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let path = dir.join(CATNIP_CONFIG);

        write_config(&path, "secret-key").unwrap();
        let written = fs::read_to_string(&path).unwrap();
        assert!(written.contains("auth_key = secret-key"));
        assert!(written.contains("allow_insecure_http = true"));

        // Re-writing the same key must not change the file.
        write_config(&path, "secret-key").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), written);

        // A different key replaces the old one in place.
        write_config(&path, "new-key").unwrap();
        let written = fs::read_to_string(&path).unwrap();
        assert!(written.contains("auth_key = new-key"));
        assert!(!written.contains("secret-key"));

        let _ = fs::remove_dir_all(&dir);
    }
}
