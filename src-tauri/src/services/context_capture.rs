use crate::models::context_snapshot::ContextSnapshot;
use uuid::Uuid;

#[cfg(target_os = "macos")]
pub fn capture_current_context() -> ContextSnapshot {
    let (app, title) = get_frontmost_app_info();
    ContextSnapshot {
        id: Uuid::new_v4().to_string(),
        task_id: None,
        captured_at: chrono::Utc::now().to_rfc3339(),
        app: Some(app),
        window_title: Some(title),
        url: None,
        repo: None,
        branch: None,
        file_path: None,
        note: None,
    }
}

#[cfg(not(target_os = "macos"))]
pub fn capture_current_context() -> ContextSnapshot {
    ContextSnapshot {
        id: Uuid::new_v4().to_string(),
        task_id: None,
        captured_at: chrono::Utc::now().to_rfc3339(),
        app: None,
        window_title: None,
        url: None,
        repo: None,
        branch: None,
        file_path: None,
        note: None,
    }
}

#[cfg(target_os = "macos")]
fn get_frontmost_app_info() -> (String, String) {
    use std::process::Command;

    // Use AppleScript as a reliable way to get frontmost app info
    // This avoids complex FFI while being equally effective
    let app_name = Command::new("osascript")
        .args(["-e", "tell application \"System Events\" to get name of first application process whose frontmost is true"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "Unknown".to_string());

    let window_title = Command::new("osascript")
        .args(["-e", "tell application \"System Events\" to get title of front window of first application process whose frontmost is true"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout).ok()
            } else {
                None
            }
        })
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    (app_name, window_title)
}
