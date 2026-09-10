//! The way a tool reaches the interface.
//!
//! Some of what the user can do never touches the database — switching to the
//! archive, opening a task, changing the theme. Those tools do not pretend to
//! do the work themselves: they hand the interface an instruction and say so.
//! The window is the one that knows how to switch a view or apply a theme, and
//! it stays the only place that knows.

use serde_json::Value;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

static APP: OnceLock<AppHandle> = OnceLock::new();

/// Remember the window to talk to. Called once, when the app starts.
pub fn attach(app: AppHandle) {
    let _ = APP.set(app);
}

/// Ask the interface to do something.
///
/// Returns what the assistant should tell the user — including the honest
/// answer when there is no window listening.
pub fn request(action: &str, params: Value) -> String {
    let Some(app) = APP.get() else {
        return "The app window is not available right now".to_string();
    };

    let payload = serde_json::json!({ "action": action, "params": params });
    match app.emit("ai-ui-command", payload) {
        Ok(()) => format!("Asked the app to {}", action.replace('_', " ")),
        Err(e) => format!("Could not reach the app window: {}", e),
    }
}
