//! Dev-only `.env.local` loader for the launcher's Rust backend.
//!
//! ## Why this exists
//!
//! Vite reads `.env.local` automatically for the renderer (`VITE_*`
//! vars), but the Rust backend ignores it — `std::env::var` only
//! consults the shell environment. Without plumbing, dev overrides
//! like `LAUNCHER_API_BASE_URL=http://localhost:3002` set in
//! `.env.local` do nothing for Rust-side code paths (the hardware
//! enrollment endpoint, for example, hits the prod `api.zemu.uk`).
//!
//! Loading `.env.local` here means the workspace's existing
//! `.env.local` (which Vite already reads) becomes the single
//! source of truth for dev overrides across both halves of the
//! stack. Shell env still wins, matching the behaviour of dotenv
//! and Vite.
//!
//! ## Why not just add `dotenvy` to Cargo.toml
//!
//! The launcher's Cargo deps stay minimal; one tiny parser is
//! cheaper than a transitive tree of crates for what's a 20-line
//! problem. The parser only handles the subset of `.env` syntax we
//! actually use in `.env.local`:
//!
//!   - `# ...` comments
//!   - blank lines
//!   - `KEY=VALUE` (with optional surrounding whitespace)
//!   - values may be quoted with `"` or `'`; quotes are stripped
//!   - everything is treated as raw text (no variable expansion,
//!     no command substitution, no escape sequences)
//!
//! Anything fancier is probably a bug — `.env.local` should hold
//! URLs and ports, not Bash.
//!
//! ## Production posture
//!
//! Production bundles do **not** ship `.env.local`. The bundled
//! `.exe` sits under `Program Files\` (Windows) or
//! `/Applications/` (macOS); there's no `.env.local` next to it,
//! so the loader silently returns. Code that needs a URL falls
//! through to its hard-coded production default. There is no
//! surface area for a leaked dev secret to reach a production
//! install.
//!
//! ## When the loader runs
//!
//! `load()` is invoked at the very top of `run()` in `lib.rs`, before
//! any Tauri command is registered. The `std::env::set_var` calls
//! mutate the process environment in place, so any subsequent
//! `std::env::var(...)` lookup (in `hardware_api`, `launch_args`,
//! etc.) sees the populated values. `set_var` is documented as
//! thread-unsafe in newer Rust, but the loader runs before the
//! Tauri runtime spawns the command-handler worker pool, so no
//! concurrent reader can race it.

use std::path::PathBuf;

/// Maximum number of parent directories to walk up when searching
/// for `.env.local`. Four is generous — covers the launcher's
/// `src-tauri/` cwd, the workspace root, and two parents above
/// that for monorepo edge cases.
const MAX_PARENT_WALK: usize = 4;

/// File name we look for. Matches Vite's convention; the existing
/// `.env.example` and `.env.local` in the launcher workspace use
/// this exact name.
const ENV_FILE_NAME: &str = ".env.local";

/// Load dev-only env overrides from `.env.local` in the current
/// working directory or any of its (up to `MAX_PARENT_WALK`)
/// parents. Existing shell env values are **not** overwritten —
/// shell exports win, matching `dotenv`'s default behaviour.
///
/// Returns `Ok(Some(path))` if a file was loaded,
/// `Ok(None)` if no `.env.local` exists in any search location,
/// or `Err(...)` if a found file failed to read. Parse errors on
/// individual lines are logged and skipped (we never fail the
/// whole app on a single malformed line).
pub fn load() -> anyhow::Result<Option<PathBuf>> {
    let Some(path) = find_env_file() else {
        return Ok(None);
    };

    let raw = match std::fs::read_to_string(&path) {
        Ok(content) => content,
        Err(err) => {
            return Err(anyhow::anyhow!(
                "failed reading {}: {err}",
                path.display()
            ));
        }
    };

    let parsed = parse(&raw);
    let applied = apply_to_env(&parsed);

    // Best-effort: a failed log append is fine — the loader still
    // did its job. The log is the operator's breadcrumb for
    // debugging "why is this hitting prod?".
    eprintln!(
        "[dev_env] loaded {} ({} entries, {} applied to process env)",
        path.display(),
        parsed.len(),
        applied,
    );

    Ok(Some(path))
}

/// Find the nearest `.env.local` to the current working directory.
/// Walks up parent directories, capped at `MAX_PARENT_WALK` levels,
/// then gives up. Returns `None` if no file is found in scope.
fn find_env_file() -> Option<PathBuf> {
    let cwd = std::env::current_dir().ok()?;
    let mut candidate = cwd.as_path();
    for _ in 0..=MAX_PARENT_WALK {
        let path = candidate.join(ENV_FILE_NAME);
        if path.is_file() {
            return Some(path);
        }
        match candidate.parent() {
            Some(parent) => candidate = parent,
            None => break,
        }
    }
    None
}

/// Parse `.env.local` text into a list of `(key, value)` pairs.
/// Empty lines and `# ...` comments are skipped. Unquoted values
/// are stripped of surrounding whitespace; quoted values have their
/// wrapping quotes stripped but preserve internal whitespace.
fn parse(raw: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some((key, value)) = trimmed.split_once('=') else {
            // Not a `KEY=VALUE` line — silently skip. A misformatted
            // line in `.env.local` shouldn't take down the app.
            continue;
        };
        let key = key.trim().to_string();
        if key.is_empty() {
            continue;
        }
        let value = unquote(value.trim());
        out.push((key, value));
    }
    out
}

/// Strip a single layer of matching `"` or `'` quotes from `value`.
/// Unbalanced quotes are left as-is — Vite handles them the same
/// way and we don't want to start guessing at escape semantics.
fn unquote(value: &str) -> String {
    if value.len() >= 2 {
        let bytes = value.as_bytes();
        let first = bytes[0];
        let last = bytes[bytes.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            return value[1..value.len() - 1].to_string();
        }
    }
    value.to_string()
}

/// Push each parsed `KEY=VALUE` into the process env **only if**
/// `KEY` is not already set. Returns the number of values actually
/// applied (i.e. the new ones, not the shell-supplied ones).
fn apply_to_env(parsed: &[(String, String)]) -> usize {
    let mut applied = 0;
    for (key, value) in parsed {
        if std::env::var_os(key).is_some() {
            // Shell env wins.
            continue;
        }
        // SAFETY: see the module-level comment — this runs before
        // any other thread reads the env, and Tauri hasn't spawned
        // its command worker pool yet.
        std::env::set_var(key, value);
        applied += 1;
    }
    applied
}

/// Public helper for tests and the rare case where a caller wants
/// to know whether a `.env.local` exists in scope without applying
/// it. Used by the dev-only sanity-check command.
#[allow(dead_code)]
pub fn locate() -> Option<PathBuf> {
    find_env_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_basic_key_value() {
        let raw = "FOO=bar\nBAZ=qux\n";
        let parsed = parse(raw);
        assert_eq!(
            parsed,
            vec![
                ("FOO".to_string(), "bar".to_string()),
                ("BAZ".to_string(), "qux".to_string()),
            ]
        );
    }

    #[test]
    fn skips_blank_and_comment_lines() {
        let raw = "\n# a comment\n\nFOO=bar\n   \n# trailing\n";
        let parsed = parse(raw);
        assert_eq!(parsed, vec![("FOO".to_string(), "bar".to_string())]);
    }

    #[test]
    fn strips_surrounding_whitespace() {
        let raw = "  FOO  =  bar  \n";
        let parsed = parse(raw);
        assert_eq!(parsed, vec![("FOO".to_string(), "bar".to_string())]);
    }

    #[test]
    fn strips_matching_double_quotes() {
        let raw = "FOO=\"hello world\"\n";
        let parsed = parse(raw);
        assert_eq!(parsed, vec![("FOO".to_string(), "hello world".to_string())]);
    }

    #[test]
    fn strips_matching_single_quotes() {
        let raw = "FOO='hello world'\n";
        let parsed = parse(raw);
        assert_eq!(parsed, vec![("FOO".to_string(), "hello world".to_string())]);
    }

    #[test]
    fn unquote_leaves_unbalanced_quotes_alone() {
        let raw = "FOO=\"unterminated\n";
        let parsed = parse(raw);
        assert_eq!(
            parsed,
            vec![("FOO".to_string(), "\"unterminated".to_string())]
        );
    }

    #[test]
    fn skips_lines_without_equals() {
        let raw = "FOO\nBAR=baz\n";
        let parsed = parse(raw);
        assert_eq!(parsed, vec![("BAR".to_string(), "baz".to_string())]);
    }

    #[test]
    fn skips_lines_with_empty_key() {
        let raw = "=value\nFOO=bar\n";
        let parsed = parse(raw);
        assert_eq!(parsed, vec![("FOO".to_string(), "bar".to_string())]);
    }
}
