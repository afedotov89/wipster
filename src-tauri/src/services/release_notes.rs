//! What changed, and in which version.
//!
//! `CHANGELOG.md` at the root of the repository is the only place release notes
//! are written. It is compiled into the binary, so the app can always say what
//! it brought — no network, no second copy that drifts — and the release
//! workflow lifts the same section into the GitHub release and `latest.json`,
//! which is what the update banner shows for a version that is not installed
//! yet. One text, three readers.

use serde::Serialize;

/// The notes, as shipped. `include_str!` also makes the binary depend on the
/// file, so editing it rebuilds and re-runs the test below.
const CHANGELOG: &str = include_str!("../../../CHANGELOG.md");

/// One released version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Release {
    pub version: String,
    /// `YYYY-MM-DD`, as written in the heading. Empty if the heading omitted it.
    pub date: String,
    /// The section's body, still markdown — the app renders it.
    pub notes: String,
}

/// The version this build is.
pub fn current_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Every release in the changelog, newest first — the order of the file.
///
/// The format is deliberately the plainest markdown that can be read by a
/// person, an `awk` in the release workflow and this parser alike:
/// `## X.Y.Z — YYYY-MM-DD`, then the bullets, until the next such heading.
pub fn releases() -> Vec<Release> {
    parse(CHANGELOG)
}

/// The notes for one version, if it has any.
pub fn for_version(version: &str) -> Option<Release> {
    releases().into_iter().find(|r| r.version == version)
}

fn parse(text: &str) -> Vec<Release> {
    let mut releases: Vec<Release> = Vec::new();
    let mut notes = String::new();

    for line in text.lines() {
        if let Some(heading) = line.strip_prefix("## ") {
            if let Some(last) = releases.last_mut() {
                last.notes = notes.trim().to_string();
            }
            notes.clear();

            let mut words = heading.split_whitespace();
            let version = words.next().unwrap_or_default().to_string();
            // Anything after the version is the date, however it is separated —
            // a dash today, something else if the file is ever restyled.
            let date = words
                .find(|w| w.len() == 10 && w.starts_with("20") && w.matches('-').count() == 2)
                .unwrap_or_default()
                .to_string();

            releases.push(Release { version, date, notes: String::new() });
            continue;
        }

        if !releases.is_empty() {
            notes.push_str(line);
            notes.push('\n');
        }
    }

    if let Some(last) = releases.last_mut() {
        last.notes = notes.trim().to_string();
    }

    releases
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The promise that the notes cannot rot: a version without a section fails
    /// here, in the same commit that bumped it, instead of shipping an update
    /// whose banner has nothing to say.
    #[test]
    fn the_version_being_shipped_has_release_notes() {
        let version = current_version();
        let release = for_version(version).unwrap_or_else(|| {
            panic!("CHANGELOG.md has no `## {version} — YYYY-MM-DD` section. Add one before releasing.")
        });

        assert!(
            !release.notes.trim().is_empty(),
            "the section for {version} is empty — say what changed",
        );
        assert_eq!(release.date.len(), 10, "version {version} needs a date");
    }

    #[test]
    fn the_newest_version_comes_first() {
        let releases = releases();
        assert_eq!(releases[0].version, current_version());
        assert!(releases.len() > 1, "the file keeps the history, not just today");
    }

    #[test]
    fn a_section_is_a_version_a_date_and_its_bullets() {
        let parsed = parse(
            "# Что нового\n\nвступление\n\n\
             ## 1.2.0 — 2026-09-15\n\n- сделали это\n- и это\n\n\
             ## 1.1.0 — 2026-09-01\n\n- чинили\n",
        );

        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].version, "1.2.0");
        assert_eq!(parsed[0].date, "2026-09-15");
        assert_eq!(parsed[0].notes, "- сделали это\n- и это");
        assert_eq!(parsed[1].version, "1.1.0");
        assert_eq!(parsed[1].notes, "- чинили");
    }

    #[test]
    fn the_preamble_is_not_a_release() {
        let parsed = parse("# Заголовок\n\nтекст про правила\n");
        assert!(parsed.is_empty());
    }
}
