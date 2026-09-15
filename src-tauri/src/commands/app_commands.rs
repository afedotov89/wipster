use crate::services::release_notes::{self, Release};

/// What the app is, and what each version of it brought.
#[derive(serde::Serialize)]
pub struct AppInfo {
    pub version: String,
    /// Newest first, as written in `CHANGELOG.md`.
    pub releases: Vec<Release>,
}

/// The version on screen and the history behind it.
///
/// Both come from the binary itself — the version from Cargo, the notes from
/// the changelog compiled into it — so "what changed" is answerable offline and
/// straight after an update, which is exactly when it is asked.
#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        version: release_notes::current_version().to_string(),
        releases: release_notes::releases(),
    }
}
