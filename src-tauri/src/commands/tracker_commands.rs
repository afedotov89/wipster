use tauri::State;

use crate::db::connection::DbState;
use crate::services::tracker_auth;

fn get_setting(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
        r.get::<_, String>(0)
    })
    .ok()
    .filter(|s| !s.is_empty())
}

fn set_setting(conn: &rusqlite::Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Serialize)]
pub struct DeviceAuthStart {
    pub user_code: String,
    pub verification_url: String,
}

/// Step 1: Start device auth flow — returns code for user to enter
#[tauri::command]
pub async fn tracker_start_auth(db: State<'_, DbState>) -> Result<DeviceAuthStart, String> {
    let client_id = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        get_setting(&conn, "tracker_client_id").ok_or("Введите Client ID")?
    };

    let device = tracker_auth::request_device_code(&client_id).await?;

    // Store device_code and params for polling
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        set_setting(&conn, "tracker_device_code", &device.device_code)?;
        set_setting(&conn, "tracker_poll_interval", &device.interval.to_string())?;
        set_setting(&conn, "tracker_poll_expires", &device.expires_in.to_string())?;
    }

    Ok(DeviceAuthStart {
        user_code: device.user_code,
        verification_url: device.verification_url,
    })
}

/// Step 2: Poll for token after user authorized
#[tauri::command]
pub async fn tracker_poll_token(db: State<'_, DbState>) -> Result<String, String> {
    let (client_id, client_secret, device_code, interval, expires_in) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let client_id = get_setting(&conn, "tracker_client_id").ok_or("No client_id")?;
        let client_secret = get_setting(&conn, "tracker_client_secret").unwrap_or_default();
        let device_code = get_setting(&conn, "tracker_device_code").ok_or("No device_code")?;
        let interval: u64 = get_setting(&conn, "tracker_poll_interval")
            .and_then(|s| s.parse().ok())
            .unwrap_or(5);
        let expires_in: u64 = get_setting(&conn, "tracker_poll_expires")
            .and_then(|s| s.parse().ok())
            .unwrap_or(300);
        (client_id, client_secret, device_code, interval, expires_in)
    };

    let token = tracker_auth::poll_for_token(&client_id, &client_secret, &device_code, interval, expires_in).await?;

    // Save token
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        set_setting(&conn, "tracker_token", &token)?;
    }

    // Auto-detect org ID
    match tracker_auth::detect_org_id(&token).await {
        Ok(org_id) => {
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            set_setting(&conn, "tracker_org_id", &org_id)?;
            Ok(format!("Подключено! Org ID: {}", org_id))
        }
        Err(e) => Ok(format!("Токен получен. {}", e)),
    }
}

#[tauri::command]
pub fn tracker_status(db: State<'_, DbState>) -> Result<bool, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let has_token = get_setting(&conn, "tracker_token").is_some();
    let has_org = get_setting(&conn, "tracker_org_id").is_some();
    Ok(has_token && has_org)
}
