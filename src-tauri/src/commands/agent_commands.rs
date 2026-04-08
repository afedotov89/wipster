use tauri::State;

use crate::db::connection::DbState;
use crate::services::logger;
use crate::models::project::Project;
use crate::models::task::Task;
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
    let (provider, api_key, model, tasks, projects, memory, focused_task_context) = {
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

        let mut stmt = conn
            .prepare(
                "SELECT id, title, project_id, status, priority, energy, due, estimate, time_estimate, tags, \
                 dod, checklist, next_step, return_ref, promised_to, comment, tracker_url, position, completed_at, created_at, updated_at FROM tasks",
            )
            .map_err(|e| e.to_string())?;

        let tasks: Vec<Task> = stmt
            .query_map([], |row| {
                Ok(Task {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    project_id: row.get(2)?,
                    status: row.get(3)?,
                    priority: row.get(4)?,
                    energy: row.get(5)?,
                    due: row.get(6)?,
                    estimate: row.get(7)?,
                    time_estimate: row.get(8)?,
                    tags: row.get(9)?,
                    dod: row.get(10)?,
                    checklist: row.get(11)?,
                    next_step: row.get(12)?,
                    return_ref: row.get(13)?,
                    promised_to: row.get(14)?,
                    comment: row.get(15)?, tracker_url: row.get(16)?, position: row.get(17)?,
                    completed_at: row.get(18)?,
                    created_at: row.get(19)?,
                    updated_at: row.get(18)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        let mut pstmt = conn
            .prepare("SELECT id, name, icon, color, \"order\", created_at, updated_at FROM projects ORDER BY \"order\" ASC")
            .map_err(|e| e.to_string())?;
        let projects: Vec<Project> = pstmt
            .query_map([], |row| {
                Ok(Project {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    icon: row.get(2)?,
                    color: row.get(3)?,
                    order: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        let memory = get_setting_value(&conn, "agent_memory").unwrap_or_default();

        let focused_task_context = focused_task_id.as_ref().and_then(|fid| {
            tasks.iter().find(|t| &t.id == fid).map(|t| {
                let project_name = t.project_id.as_ref().and_then(|pid| {
                    projects.iter().find(|p| &p.id == pid).map(|p| p.name.clone())
                }).unwrap_or_default();
                format!(
                    "Currently focused task: \"{}\" (id: {}, project: {}, status: {}, priority: {:?}, due: {:?}, dod: {:?}, promised_to: {:?})",
                    t.title, t.id, project_name, t.status,
                    t.priority, t.due, t.dod, t.promised_to
                )
            })
        }).unwrap_or_default();

        (provider, api_key, model, tasks, projects, memory, focused_task_context)
    };

    let hist = history.unwrap_or_default();
    let result = agent::chat(
        &provider, &api_key, &model, &message, &hist,
        &tasks, &projects, &memory, &focused_task_context,
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
