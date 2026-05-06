use tauri::State;

use crate::db::connection::DbState;
use crate::services::logger;
use crate::services::agent::{self, AgentResponse};

#[tauri::command]
pub fn get_backend_logs() -> Vec<String> {
    logger::drain()
}

#[tauri::command]
pub fn get_setting(db: State<'_, DbState>, key: String) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        [&key],
        |row| row.get::<_, String>(0),
    );
    match result {
        Ok(val) => Ok(Some(val)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn set_setting(db: State<'_, DbState>, key: String, value: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_setting_value(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
        row.get(0)
    })
    .ok()
}

#[tauri::command]
pub async fn agent_chat(
    db: State<'_, DbState>,
    message: String,
    focused_task_id: Option<String>,
    history: Option<Vec<(String, String)>>,
) -> Result<AgentResponse, String> {
    crate::services::logger::log("info", &format!("[agent_chat] received message: {}, focused_task: {:?}", message, focused_task_id));
    let (provider, api_key, model, memory, focused_task_context) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;

        let provider = get_setting_value(&conn, "llm_provider").unwrap_or_else(|| "anthropic".to_string());

        let api_key = match provider.as_str() {
            "openrouter" => get_setting_value(&conn, "openrouter_api_key"),
            _ => get_setting_value(&conn, "anthropic_api_key"),
        }
        .ok_or("API_KEY_NOT_SET")?;

        let default_model = match provider.as_str() {
            "openrouter" => "anthropic/claude-sonnet-4",
            _ => "claude-sonnet-4-20250514",
        };
        let model = get_setting_value(&conn, "llm_model").unwrap_or_else(|| default_model.to_string());

        let memory = get_setting_value(&conn, "agent_memory").unwrap_or_default();

        let focused_task_context = focused_task_id.as_ref().and_then(|fid| {
            conn.query_row(
                "SELECT t.id, t.title, COALESCE(p.name, ''), t.status, \
                 COALESCE(t.priority, ''), COALESCE(t.due, ''), \
                 COALESCE(t.dod, ''), COALESCE(t.promised_to, ''), \
                 COALESCE(t.time_estimate, ''), COALESCE(t.tracker_url, '') \
                 FROM tasks t LEFT JOIN projects p ON t.project_id = p.id WHERE t.id = ?1",
                [fid],
                |row| {
                    Ok(format!(
                        "id: {}\ntitle: {}\nproject: {}\nstatus: {}\npriority: {}\ndue: {}\ndod: {}\npromised_to: {}\nestimate: {}\ntracker_url: {}",
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, String>(7)?,
                        row.get::<_, String>(8)?,
                        row.get::<_, String>(9)?,
                    ))
                },
            ).ok()
        }).unwrap_or_default();

        (provider, api_key, model, memory, focused_task_context)
    };

    let hist = history.unwrap_or_default();
    let result = agent::chat(
        &provider, &api_key, &model, &message, &hist,
        &memory, &focused_task_context,
        &db.0,
    ).await?;

    crate::services::logger::log("info", &format!("[agent_chat] done: {} tool calls, {} pending, text len: {}",
        result.tool_calls.len(), result.pending_confirmations.len(), result.text.len()));
    Ok(result)
}

/// Execute confirmed dangerous tools
#[tauri::command]
pub async fn agent_confirm(
    db: State<'_, DbState>,
    tool_calls: Vec<agent::PendingToolCall>,
) -> Result<Vec<agent::ToolCallLog>, String> {
    let mut results = Vec::new();
    for tc in &tool_calls {
        let result = agent::execute_confirmed_tool(&tc.tool_name, &tc.arguments, &db.0).await;
        crate::services::logger::log("info", &format!("[agent] confirmed tool {} -> {}", tc.tool_name, &result[..result.len().min(200)]));
        results.push(agent::ToolCallLog {
            tool_name: tc.tool_name.clone(),
            arguments: tc.arguments.clone(),
            result,
        });
    }
    Ok(results)
}
