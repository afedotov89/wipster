//! What the app itself is — the one thing the assistant can say about the
//! program rather than about the work inside it.

use rusqlite::Connection;
use serde_json::{json, Value};

use super::{Availability, Danger, Handler, Tool};
use crate::services::release_notes;

/// What changed, in this version or an earlier one.
pub fn read_release_notes(_conn: &Connection, args: &Value) -> Result<String, String> {
    let current = release_notes::current_version();
    let asked = args["version"].as_str().unwrap_or("").trim();

    if asked.is_empty() || asked == current {
        let release = release_notes::for_version(current)
            .ok_or("This build ships without release notes")?;
        return Ok(format!(
            "Running version {} (released {}).\n\n{}",
            release.version, release.date, release.notes,
        ));
    }

    if asked == "all" {
        let all = release_notes::releases()
            .iter()
            .map(|r| format!("## {} — {}\n{}", r.version, r.date, r.notes))
            .collect::<Vec<_>>()
            .join("\n\n");
        return Ok(format!("Running version {current}.\n\n{all}"));
    }

    match release_notes::for_version(asked) {
        Some(r) => Ok(format!("Version {} (released {}).\n\n{}", r.version, r.date, r.notes)),
        None => Err(format!(
            "No release notes for version {asked}. Known versions: {}",
            release_notes::releases()
                .iter()
                .map(|r| r.version.clone())
                .collect::<Vec<_>>()
                .join(", "),
        )),
    }
}

pub fn tools() -> Vec<Tool> {
    vec![Tool {
        name: "release_notes",
        summary: "What changed in this version of the app, or in an earlier one. Also gives the version the user is running.",
        keywords: &[
            "что нового", "версия", "обновление", "изменения", "релиз", "чейнджлог",
            "what's new", "version", "update", "changes", "release notes", "changelog",
        ],
        availability: Availability::OnDemand,
        danger: Danger::Safe,
        params: || {
            json!({
                "type": "object",
                "properties": {
                    "version": {
                        "type": "string",
                        "description": "A version like \"0.10.0\", or \"all\" for the whole history. Omit for the running one.",
                    },
                },
            })
        },
        handler: Handler::Db(read_release_notes),
    }]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        Connection::open_in_memory().unwrap()
    }

    #[test]
    fn without_arguments_it_answers_about_the_running_version() {
        let answer = read_release_notes(&conn(), &json!({})).unwrap();
        assert!(answer.contains(release_notes::current_version()));
    }

    #[test]
    fn an_older_version_is_answerable_too() {
        let answer = read_release_notes(&conn(), &json!({"version": "0.4.0"})).unwrap();
        assert!(answer.contains("0.4.0"));
    }

    #[test]
    fn a_version_that_never_existed_says_which_ones_did() {
        let err = read_release_notes(&conn(), &json!({"version": "9.9.9"})).unwrap_err();
        assert!(err.contains("0.4.0"), "the error should list the versions there are: {err}");
    }
}
