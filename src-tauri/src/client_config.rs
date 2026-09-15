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

use std::fs;
use std::path::Path;

use anyhow::{Context, Result};

/// Section name we own (case sensitive — matches the game's spec).
const SECTION: &str = "Internationalization";
/// Key we own inside the section.
const KEY: &str = "Locale";

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
}
