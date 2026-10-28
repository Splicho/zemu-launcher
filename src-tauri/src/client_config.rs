//! Surgical edit for the H1Z1 client's `ClientConfig.ini`.
//!
//! We only own the `[Internationalization]` block, and only the
//! `Locale=` key inside it. Everything else in the file is the
//! game's own state — we must preserve it byte-for-byte.
//!
//! The format is a plain Windows-style INI:
//!
//! ```text
//! ; comment
//! [SectionName]
//! key=value
//! another=value with spaces
//!
//! [OtherSection]
//! ...
//! ```
//!
//! Lines can be terminated by `\n` or `\r\n`; we write `\r\n` for
//! compatibility with the rest of the file (H1Z1's own file uses
//! `\r\n` per the test fixture in `wine.rs`). Blank lines and
//! comment lines (starting with `;` or `#`) are passed through
//! unchanged.
//!
//! We deliberately don't pull in a full INI parsing crate just to
//! update one key — the surface area is small and the risk of a
//! parser munging an unrelated section's quoting or escaping is
//! higher than the cost of this hand-rolled scanner.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

/// Section name we own (case sensitive — matches the game's spec).
const SECTION: &str = "Internationalization";
/// Key we own inside the section.
const KEY: &str = "Locale";

/// Live config file the game and the launcher both write to.
const LIVE_FILE_NAME: &str = "ClientConfig.ini";

/// Pristine copy of the default the launcher last applied. Kept beside
/// the live file (same directory) so a config shipped in a later patch
/// can be merged against the values the user actually started from.
///
/// This file is launcher-owned, is **not** part of the depot manifest,
/// and is never read by the game.
pub const SEED_FILE_NAME: &str = "ClientConfig.default.ini";

/// True when `path` is the live H1Z1 config — the one the game rewrites
/// at runtime. Matched by basename, case-insensitively, against
/// manifest-style relative paths.
///
/// The updater and the integrity verifier treat these paths specially:
/// their on-disk bytes are expected to drift from the manifest, so they
/// are excluded from hash verification, while manifest hash changes are
/// still honoured (see `update::compute_files_to_update`).
pub fn is_seed_path(path: &str) -> bool {
    path.rsplit(['/', '\\'])
        .next()
        .map(|name| name.eq_ignore_ascii_case(LIVE_FILE_NAME))
        .unwrap_or(false)
}

/// Path of the pristine default beside `live_path`.
pub fn seed_path_for(live_path: &Path) -> PathBuf {
    live_path.with_file_name(SEED_FILE_NAME)
}

/// Update the `Locale` key in the `[Internationalization]` section
/// of the file at `path`. If the section doesn't exist it's
/// appended at the end; if the key doesn't exist within an
/// existing section it's appended to that section; everything
/// else is preserved exactly.
///
/// `locale` is the bare tag (e.g. `"en_us"`). If you want to
/// clear the language, pass `""` — the game treats an empty
/// `Locale=` as "use built-in default", same as our launcher
/// arg path.
///
/// Returns `Ok(())` on a successful write, even if no change was
/// needed. Errors are I/O or permission failures.
pub fn set_locale(path: &Path, locale: &str) -> Result<()> {
    let original = if path.exists() {
        fs::read_to_string(path)
            .with_context(|| format!("read {}", path.display()))?
    } else {
        String::new()
    };

    let updated = update_locale_in_string(&original, locale);

    if updated == original {
        // No change — skip the write so we don't bump mtime /
        // trigger filesystem watchers for nothing.
        return Ok(());
    }

    // An empty input is a brand-new file — write with a trailing
    // newline so the file ends on a line terminator (most editors
    // and INI tools expect this and the rest of our write paths
    // produce it).
    let to_write = if original.is_empty() {
        updated + "\n"
    } else {
        updated.clone()
    };

    fs::write(path, to_write).with_context(|| format!("write {}", path.display()))?;
    Ok(())
}

/// Apply a freshly-downloaded default config to the live `ClientConfig.ini`.
///
/// This is the write path the updater uses instead of writing the
/// manifest bytes over the live file. H1Z1 rewrites its own config at
/// runtime, so the live file and the manifest can never agree; treating
/// the depot file as a *seed* is what lets a shipped default change
/// reach existing installs without re-downloading the file on every
/// launch.
///
/// - No live file yet (fresh install): write both the live file and the
///   pristine default (`ClientConfig.default.ini`).
/// - Live file exists: three-way merge the new default into it (see
///   [`merge_ini`]) and refresh the pristine copy so the next update
///   merges against the defaults this one applied.
///
/// Returns `true` when the live file changed.
pub fn apply_seed_bytes(live_path: &Path, shipped: &[u8]) -> Result<bool> {
    let seed_path = seed_path_for(live_path);

    if !live_path.exists() {
        if let Some(parent) = live_path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("create {}", parent.display()))?;
        }
        fs::write(live_path, shipped)
            .with_context(|| format!("write {}", live_path.display()))?;
        fs::write(&seed_path, shipped)
            .with_context(|| format!("write {}", seed_path.display()))?;
        return Ok(true);
    }

    // A non-UTF-8 config is not something we can merge safely. Refresh
    // the pristine default only and leave the user's file untouched.
    let live = match fs::read(live_path)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
    {
        Some(text) => text,
        None => {
            fs::write(&seed_path, shipped)
                .with_context(|| format!("write {}", seed_path.display()))?;
            return Ok(false);
        }
    };

    let Some(shipped_text) = std::str::from_utf8(shipped).ok() else {
        fs::write(&seed_path, shipped)
            .with_context(|| format!("write {}", seed_path.display()))?;
        return Ok(false);
    };

    let baseline = fs::read(&seed_path)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .unwrap_or_default();

    let merged = merge_ini(&live, &baseline, shipped_text);
    let changed = merged != live;
    if changed {
        fs::write(live_path, merged.as_bytes())
            .with_context(|| format!("write {}", live_path.display()))?;
    }
    fs::write(&seed_path, shipped)
        .with_context(|| format!("write {}", seed_path.display()))?;

    Ok(changed)
}

/// Restore the live config from the pristine default when it has gone
/// missing (deleted by the user, dropped by a failed patch, …).
///
/// No-op when the live file exists or no pristine default was ever
/// captured. Best-effort by design: the caller treats a failure as
/// non-fatal and lets `set_locale` create a minimal file instead.
pub fn seed_if_missing(live_path: &Path) -> Result<bool> {
    if live_path.exists() {
        return Ok(false);
    }
    let seed_path = seed_path_for(live_path);
    if !seed_path.exists() {
        return Ok(false);
    }
    if let Some(parent) = live_path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("create {}", parent.display()))?;
    }
    fs::copy(&seed_path, live_path).with_context(|| {
        format!(
            "copy {} to {}",
            seed_path.display(),
            live_path.display()
        )
    })?;
    Ok(true)
}

#[derive(Debug, Clone)]
struct IniEntry {
    section: String,
    key: String,
    value: String,
}

type IniKey = (String, String);

fn ini_key(section: &str, key: &str) -> IniKey {
    (section.to_lowercase(), key.to_lowercase())
}

/// Parse the `key=value` pairs of an INI file, tracking the current
/// `[section]`. Comments, blanks and duplicate keys are handled the way
/// an INI reader would (the last duplicate wins for the value maps the
/// caller builds).
fn parse_ini_entries(contents: &str) -> Vec<IniEntry> {
    let body = contents.strip_prefix('\u{feff}').unwrap_or(contents);
    let mut section = String::new();
    let mut entries = Vec::new();

    for raw in body.split('\n') {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with(';') || trimmed.starts_with('#') {
            continue;
        }
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            section = trimmed[1..trimmed.len() - 1].trim().to_string();
            continue;
        }
        let Some(eq) = line.find('=') else {
            continue;
        };
        let key = line[..eq].trim();
        if key.is_empty() {
            continue;
        }
        entries.push(IniEntry {
            section: section.clone(),
            key: key.to_string(),
            value: line[eq + 1..].trim().to_string(),
        });
    }

    entries
}

/// `(name, header index, end exclusive)` for every `[section]` line.
fn section_ranges(lines: &[String]) -> Vec<(String, usize, usize)> {
    let mut ranges = Vec::new();
    let mut current: Option<(String, usize)> = None;

    for (index, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            if let Some((name, start)) = current.take() {
                ranges.push((name, start, index));
            }
            current = Some((trimmed[1..trimmed.len() - 1].trim().to_string(), index));
        }
    }
    if let Some((name, start)) = current {
        ranges.push((name, start, lines.len()));
    }

    ranges
}

/// Index just past the last non-blank line of a section, so appended
/// keys land after the section's content but before the blank line that
/// separates it from the next header.
fn section_insert_index(lines: &[String], header: usize, end: usize) -> usize {
    let mut last = header;
    for (index, line) in lines.iter().enumerate().take(end).skip(header + 1) {
        if !line.trim().is_empty() {
            last = index;
        }
    }
    last + 1
}

/// Three-way merge for `ClientConfig.ini`.
///
/// - `live` is the user's current file (H1Z1 and the launcher write it).
/// - `baseline` is the default this launcher applied last time.
/// - `shipped` is the new default from the depot.
///
/// Per `[section]` / key (case-insensitive):
/// - missing from `live`          → append it (creating the section if needed)
/// - present and equal to baseline→ replace with the shipped value
/// - present and different        → keep the live value (user/game edit)
/// - only in `live`               → untouched
/// - removed from `shipped`       → never deleted from `live`
///
/// Comments, ordering, blank lines and the line ending are preserved.
fn merge_ini(live: &str, baseline: &str, shipped: &str) -> String {
    let body = live.strip_prefix('\u{feff}').unwrap_or(live);
    let line_ending = if body.contains("\r\n") { "\r\n" } else { "\n" };
    let ends_with_newline = body.ends_with('\n') || body.is_empty();

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

    let live_entries = parse_ini_entries(body);
    let baseline_entries = parse_ini_entries(baseline);
    let shipped_entries = parse_ini_entries(shipped);

    let live_values: HashMap<IniKey, String> = live_entries
        .iter()
        .map(|entry| (ini_key(&entry.section, &entry.key), entry.value.clone()))
        .collect();
    let baseline_values: HashMap<IniKey, String> = baseline_entries
        .iter()
        .map(|entry| (ini_key(&entry.section, &entry.key), entry.value.clone()))
        .collect();

    let mut replacements: HashMap<IniKey, String> = HashMap::new();
    let mut additions: Vec<IniEntry> = Vec::new();
    let mut added: HashSet<IniKey> = HashSet::new();

    for entry in &shipped_entries {
        let id = ini_key(&entry.section, &entry.key);
        match live_values.get(&id) {
            Some(live_value) => {
                // Only overwrite a value that still matches the default we
                // applied last time. Anything the user or the game changed
                // wins, forever.
                let untouched = baseline_values
                    .get(&id)
                    .map(|baseline_value| baseline_value == live_value)
                    .unwrap_or(false);
                if untouched && live_value != &entry.value {
                    replacements.insert(id, entry.value.clone());
                }
            }
            None => {
                if added.insert(id) {
                    additions.push(entry.clone());
                }
            }
        }
    }

    // Replace values in place, preserving indentation, key case and
    // everything before the `=`.
    let mut current_section = String::new();
    for line in lines.iter_mut() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            current_section = trimmed[1..trimmed.len() - 1].trim().to_string();
            continue;
        }
        if trimmed.is_empty() || trimmed.starts_with(';') || trimmed.starts_with('#') {
            continue;
        }
        let Some(eq) = line.find('=') else {
            continue;
        };
        let key = line[..eq].trim();
        if key.is_empty() {
            continue;
        }
        if let Some(value) = replacements.get(&ini_key(&current_section, key)) {
            *line = format!("{}{}", &line[..=eq], value);
        }
    }

    let finish = |lines: Vec<String>| {
        let mut out = lines.join(line_ending);
        if ends_with_newline && !out.is_empty() && !out.ends_with(line_ending) {
            out.push_str(line_ending);
        }
        out
    };

    if additions.is_empty() {
        return finish(lines);
    }

    // Group additions by section, preserving the shipping order.
    let mut groups: Vec<(String, Vec<IniEntry>)> = Vec::new();
    for entry in additions {
        match groups
            .iter_mut()
            .find(|(name, _)| name.eq_ignore_ascii_case(&entry.section))
        {
            Some((_, items)) => items.push(entry),
            None => groups.push((entry.section.clone(), vec![entry])),
        }
    }

    let ranges = section_ranges(&lines);
    let first_header = ranges.first().map(|(_, header, _)| *header);
    let mut insertions: Vec<(usize, Vec<String>)> = Vec::new();
    let mut appended: Vec<String> = Vec::new();

    for (section, items) in groups {
        let rendered: Vec<String> = items
            .iter()
            .map(|entry| format!("{}={}", entry.key, entry.value))
            .collect();

        if section.is_empty() {
            // Global keys belong before the first section header.
            insertions.push((first_header.unwrap_or(lines.len()), rendered));
            continue;
        }

        match ranges
            .iter()
            .find(|(name, _, _)| name.eq_ignore_ascii_case(&section))
        {
            Some((_, header, end)) => {
                insertions.push((section_insert_index(&lines, *header, *end), rendered));
            }
            None => {
                // New section. Collect every new section into one block so
                // their shipping order is preserved.
                if !appended.is_empty() {
                    appended.push(String::new());
                }
                appended.push(format!("[{section}]"));
                appended.extend(rendered);
            }
        }
    }

    if !appended.is_empty() {
        // New sections always go at the very end of the file. Doing this
        // after the in-place insertions avoids an index tie with the last
        // existing section.
        if !lines.is_empty()
            && !lines
                .last()
                .map(|line| line.trim().is_empty())
                .unwrap_or(false)
        {
            lines.push(String::new());
        }
        lines.extend(appended);
    }

    // Insert from the bottom up so earlier indices stay valid.
    insertions.sort_by(|a, b| b.0.cmp(&a.0));
    for (index, block) in insertions {
        let index = index.min(lines.len());
        lines.splice(index..index, block);
    }

    finish(lines)
}

/// Pure transformation: given the full file contents as a string,
/// return the new contents with the `[Internationalization]` /
/// `Locale=` pair updated. Exposed for unit testing.
fn update_locale_in_string(contents: &str, locale: &str) -> String {
    let (line_ending, body) = detect_line_ending(contents);

    // Split into lines. Drop a single trailing empty entry if
    // the body ended with a newline, so the line count reflects
    // "real" lines (not a sentinel for the trailing terminator).
    let mut lines: Vec<&str> = if body.is_empty() {
        Vec::new()
    } else {
        body.split('\n').collect()
    };
    if lines.last() == Some(&"") {
        lines.pop();
    }

    // State for the parser.
    let mut in_our_section = false;
    let mut section_header_index: Option<usize> = None;
    let mut key_index_in_section: Option<usize> = None;

    for (i, raw) in lines.iter().enumerate() {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        let trimmed = line.trim_start();

        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            // Section header.
            if key_index_in_section.is_some() {
                // We saw our key inside the previous section — done.
                break;
            }
            in_our_section = trimmed[1..trimmed.len() - 1].trim() == SECTION;
            if in_our_section && section_header_index.is_none() {
                section_header_index = Some(i);
            }
            continue;
        }

        if !in_our_section {
            continue;
        }

        // Inside our section. Look for `Locale=` (or `Locale =`
        // — we'll normalise to `Locale=value` on write).
        if let Some(eq) = line.find('=') {
            let key = line[..eq].trim();
            if key == KEY {
                key_index_in_section = Some(i);
                break;
            }
        }
    }

    match (section_header_index, key_index_in_section) {
        (Some(_), Some(key_idx)) => {
            // Replace the existing key line in place.
            let mut new_lines: Vec<String> = lines
                .iter()
                .map(|raw| {
                    let stripped = raw.strip_suffix('\r').unwrap_or(raw);
                    stripped.to_string()
                })
                .collect();
            new_lines[key_idx] = format!("{KEY}={locale}");
            join_lines(&new_lines, &line_ending, body.ends_with('\n'))
        }
        (Some(sec_idx), None) => {
            // Section exists but no Locale= key — append it as the
            // last line of that section. We need to find the last
            // non-empty, non-comment line of the section so the new
            // key sits at the end of the meaningful content.
            let insert_at = last_line_of_section(&lines, sec_idx);
            let mut new_lines: Vec<String> = lines
                .iter()
                .map(|raw| {
                    let stripped = raw.strip_suffix('\r').unwrap_or(raw);
                    stripped.to_string()
                })
                .collect();
            new_lines.insert(insert_at, format!("{KEY}={locale}"));
            join_lines(&new_lines, &line_ending, body.ends_with('\n'))
        }
        (None, _) => {
            // Section doesn't exist — append a new section at the
            // end of the file. We don't insert separator blank
            // lines: an INI is a flat stream of `[section]` and
            // `key=value` lines, and the game doesn't care about
            // visual gaps. Skipping them keeps byte-for-byte
            // diffs minimal.
            let mut new_lines: Vec<String> = lines
                .iter()
                .map(|raw| {
                    let stripped = raw.strip_suffix('\r').unwrap_or(raw);
                    stripped.to_string()
                })
                .collect();

            new_lines.push(format!("[{SECTION}]"));
            new_lines.push(format!("{KEY}={locale}"));
            // An empty source file should produce a terminated
            // output file (one trailing newline) so the result is
            // a well-formed INI rather than a file with no
            // terminator. Otherwise preserve whatever the source
            // had.
            let ends_with_newline = body.ends_with('\n') || body.is_empty();
            join_lines(&new_lines, &line_ending, ends_with_newline)
        }
    }
}

/// Return the index just past the last line of the section
/// starting at `section_start` that contains real content (a
/// key=value, a comment, anything non-blank). Blank lines do
/// not count. The section ends at the next `[Section]` header
/// or end of file. If the section is empty, returns
/// `section_start + 1` so the insert lands right after the
/// header.
fn last_line_of_section(lines: &[&str], section_start: usize) -> usize {
    let mut last_content = section_start; // the header itself
    for (i, raw) in lines.iter().enumerate().skip(section_start + 1) {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            // New section — ours ended.
            break;
        }
        if !trimmed.is_empty() {
            // Comments and key=value both extend the section.
            last_content = i;
        }
    }
    last_content + 1
}

/// Detect whether the file uses `\r\n` or `\n` line endings.
/// Returns the separator and the body without a trailing newline
/// stripped (we keep the trailing-newline flag separately so
/// files that end with a newline stay that way).
fn detect_line_ending(contents: &str) -> (String, String) {
    if contents.contains("\r\n") {
        ("\r\n".to_string(), contents.to_string())
    } else {
        ("\n".to_string(), contents.to_string())
    }
}

/// Stitch a list of logical lines back into a single string.
/// `ends_with_newline` preserves whether the source file ended
/// with a terminator so we don't change that.
fn join_lines(lines: &[String], sep: &str, ends_with_newline: bool) -> String {
    let mut out = lines.join(sep);
    if ends_with_newline && !out.ends_with(sep) {
        out.push_str(sep);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_file_gets_section_appended() {
        let out = update_locale_in_string("", "en_us");
        assert_eq!(out, "[Internationalization]\nLocale=en_us\n");
    }

    #[test]
    fn empty_file_with_existing_section_appends_key() {
        let input = "[Internationalization]\n";
        let out = update_locale_in_string(input, "fr_fr");
        assert_eq!(out, "[Internationalization]\nLocale=fr_fr\n");
    }

    #[test]
    fn existing_key_is_replaced_in_place() {
        let input = "[Internationalization]\nLocale=en_us\n[Other]\nkeep=1\n";
        let out = update_locale_in_string(input, "ja_jp");
        assert_eq!(
            out,
            "[Internationalization]\nLocale=ja_jp\n[Other]\nkeep=1\n"
        );
    }

    #[test]
    fn preserves_crlf_and_unrelated_content() {
        let input = "; header comment\r\n[Graphics]\r\nWidth=1920\r\nHeight=1080\r\n[Internationalization]\r\nLocale=en_us\r\n[Audio]\r\nVolume=80\r\n";
        let out = update_locale_in_string(input, "de_de");
        assert_eq!(
            out,
            "; header comment\r\n[Graphics]\r\nWidth=1920\r\nHeight=1080\r\n[Internationalization]\r\nLocale=de_de\r\n[Audio]\r\nVolume=80\r\n"
        );
    }

    #[test]
    fn preserves_blank_and_comment_lines_around_our_section() {
        let input = "[Other]\nkey=value\n\n; a comment\n[Internationalization]\nLocale=en_us\n\n[Next]\nk=v\n";
        let out = update_locale_in_string(input, "fr_fr");
        assert_eq!(
            out,
            "[Other]\nkey=value\n\n; a comment\n[Internationalization]\nLocale=fr_fr\n\n[Next]\nk=v\n"
        );
    }

    #[test]
    fn existing_section_without_key_appends_key_at_end_of_section() {
        let input = "[Internationalization]\n; no key yet\n\n[Other]\nk=v\n";
        let out = update_locale_in_string(input, "ja_jp");
        assert_eq!(
            out,
            "[Internationalization]\n; no key yet\nLocale=ja_jp\n\n[Other]\nk=v\n"
        );
    }

    #[test]
    fn no_change_writes_nothing_on_disk() {
        // We can't easily assert on mtime here, but we can assert
        // the function returns the input verbatim so a no-op call
        // is detected by the equality check inside set_locale.
        let input = "[Internationalization]\nLocale=en_us\n";
        let out = update_locale_in_string(input, "en_us");
        assert_eq!(out, input);
    }

    #[test]
    fn file_without_trailing_newline_is_preserved() {
        let input = "[Internationalization]\nLocale=en_us";
        let out = update_locale_in_string(input, "fr_fr");
        assert_eq!(out, "[Internationalization]\nLocale=fr_fr");
    }

    #[test]
    fn different_section_with_same_key_does_not_match() {
        // `[CustomLocale]` is a different section — we must not
        // touch its Locale key.
        let input = "[CustomLocale]\nLocale=en_us\n";
        let out = update_locale_in_string(input, "ja_jp");
        assert_eq!(
            out,
            "[CustomLocale]\nLocale=en_us\n[Internationalization]\nLocale=ja_jp\n"
        );
    }

    #[test]
    fn empty_locale_writes_empty_value() {
        let input = "[Internationalization]\nLocale=en_us\n";
        let out = update_locale_in_string(input, "");
        assert_eq!(out, "[Internationalization]\nLocale=\n");
    }

    #[test]
    fn seed_paths_are_recognised_case_insensitively() {
        assert!(is_seed_path("ClientConfig.ini"));
        assert!(is_seed_path("bin\\clientconfig.INI"));
        assert!(!is_seed_path("ClientConfig.default.ini"));
        assert!(!is_seed_path("catnip-client.cfg"));
    }

    #[test]
    fn merge_adds_missing_keys_without_touching_live_values() {
        let live = "[Display]\nWidth=1920\n";
        let baseline = "[Display]\nWidth=1920\n";
        let shipped = "[Display]\nWidth=1920\nHeight=1080\n[Audio]\nVolume=50\n";
        let out = merge_ini(live, baseline, shipped);
        assert_eq!(
            out,
            "[Display]\nWidth=1920\nHeight=1080\n\n[Audio]\nVolume=50\n"
        );
    }

    #[test]
    fn merge_updates_untouched_defaults_only() {
        let live = "[Display]\nWidth=1920\nHeight=1200\n";
        let baseline = "[Display]\nWidth=1920\nHeight=1080\n";
        let shipped = "[Display]\nWidth=2560\nHeight=1440\n";
        let out = merge_ini(live, baseline, shipped);
        // Width still matched the old default -> updated. Height was
        // changed by the user -> preserved.
        assert_eq!(out, "[Display]\nWidth=2560\nHeight=1200\n");
    }

    #[test]
    fn merge_preserves_user_edits_even_when_baseline_is_missing() {
        let live = "[Display]\nWidth=1280\n";
        let out = merge_ini(live, "", "[Display]\nWidth=1920\n");
        assert_eq!(out, "[Display]\nWidth=1280\n");
    }

    #[test]
    fn merge_does_not_delete_keys_removed_from_the_default() {
        let live = "[Display]\nWidth=1920\nOldSetting=1\n";
        let baseline = "[Display]\nWidth=1920\nOldSetting=1\n";
        let shipped = "[Display]\nWidth=1920\n";
        assert_eq!(merge_ini(live, baseline, shipped), live);
    }

    #[test]
    fn merge_preserves_crlf_and_comments() {
        let live = "; user comment\r\n[Display]\r\nWidth=1920\r\n";
        let baseline = "[Display]\r\nWidth=1920\r\n";
        let shipped = "[Display]\r\nWidth=2560\r\n";
        let out = merge_ini(live, baseline, shipped);
        assert_eq!(out, "; user comment\r\n[Display]\r\nWidth=2560\r\n");
    }

    #[test]
    fn merge_with_the_same_default_is_a_no_op() {
        let live = "[Display]\nWidth=1920\n; keep me\n[Audio]\nVolume=50\n";
        let default = "[Display]\nWidth=1920\n[Audio]\nVolume=50\n";
        assert_eq!(merge_ini(live, default, default), live);
    }

    #[test]
    fn merge_handles_a_bom_prefixed_first_key() {
        let live = "\u{feff}[Display]\nWidth=1920\n";
        let baseline = "[Display]\nWidth=1920\n";
        let shipped = "[Display]\nWidth=2560\n";
        let out = merge_ini(live, baseline, shipped);
        assert_eq!(out, "[Display]\nWidth=2560\n");
    }

    #[test]
    fn seed_if_missing_restores_a_deleted_live_file() {
        let dir = std::env::temp_dir().join(format!(
            "zemu-client-config-restore-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let live = dir.join(LIVE_FILE_NAME);
        let seed = seed_path_for(&live);

        fs::write(&seed, "[Display]\nWidth=1920\n").unwrap();
        assert!(seed_if_missing(&live).unwrap());
        assert_eq!(
            fs::read_to_string(&live).unwrap(),
            "[Display]\nWidth=1920\n"
        );
        // Existing files are never touched.
        assert!(!seed_if_missing(&live).unwrap());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn apply_seed_bytes_first_install_writes_live_and_seed() {
        let dir = std::env::temp_dir().join(format!(
            "zemu-client-config-first-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let live = dir.join(LIVE_FILE_NAME);
        let shipped = b"[Display]\nWidth=1920\n";

        assert!(apply_seed_bytes(&live, shipped).unwrap());
        assert_eq!(fs::read(&live).unwrap(), shipped);
        assert_eq!(fs::read(seed_path_for(&live)).unwrap(), shipped);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn apply_seed_bytes_merges_existing_live_and_refreshes_baseline() {
        let dir = std::env::temp_dir().join(format!(
            "zemu-client-config-merge-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let live = dir.join(LIVE_FILE_NAME);
        let seed = seed_path_for(&live);

        // The user played the game: it changed `Height` and added a key.
        fs::write(&live, "[Display]\nWidth=1920\nHeight=1200\nUserKey=1\n").unwrap();
        // Last applied default.
        fs::write(&seed, "[Display]\nWidth=1920\nHeight=1080\n").unwrap();

        let shipped = b"[Display]\nWidth=2560\nHeight=1440\nNewKey=2\n";
        assert!(apply_seed_bytes(&live, shipped).unwrap());
        assert_eq!(
            fs::read_to_string(&live).unwrap(),
            "[Display]\nWidth=2560\nHeight=1200\nUserKey=1\nNewKey=2\n"
        );
        // The baseline now holds the default we just applied, so the next
        // update can tell "still default" from "user changed it".
        assert_eq!(fs::read(&seed).unwrap(), shipped);

        // Re-applying the same default changes nothing.
        assert!(!apply_seed_bytes(&live, shipped).unwrap());

        let _ = fs::remove_dir_all(&dir);
    }
}
