use tauri::State;

use crate::db::connection::DbState;
use crate::models::project::Project;
use crate::models::task::Task;
use crate::services::agent::{self, AgentResponse};

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
) -> Result<AgentResponse, String> {
    eprintln!("[agent_chat] received message: {}, focused_task: {:?}", message, focused_task_id);
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
                "SELECT id, title, project_id, status, priority, due, estimate, time_estimate, tags, \
                 dod, checklist, next_step, return_ref, promised_to, created_at, updated_at FROM tasks",
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
                    due: row.get(5)?,
                    estimate: row.get(6)?,
                    time_estimate: row.get(7)?,
                    tags: row.get(8)?,
                    dod: row.get(9)?,
                    checklist: row.get(10)?,
                    next_step: row.get(11)?,
                    return_ref: row.get(12)?,
                    promised_to: row.get(13)?,
                    created_at: row.get(14)?,
                    updated_at: row.get(15)?,
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

    eprintln!("[agent_chat] calling LLM: provider={}, model={}, tasks={}, projects={}", provider, model, tasks.len(), projects.len());
    let result = agent::chat(&provider, &api_key, &model, &message, &tasks, &projects, &memory, &focused_task_context).await;
    eprintln!("[agent_chat] LLM result: {:?}", result.as_ref().map(|r| &r.summary));
    let result = result?;

    // Process memory actions on backend
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let mut current_memory = get_setting_value(&conn, "agent_memory").unwrap_or_default();
        let mut changed = false;
        for action in &result.actions {
            match action.action.as_str() {
                "remember" => {
                    if let Some(ref val) = action.value {
                        if !current_memory.is_empty() {
                            current_memory.push('\n');
                        }
                        current_memory.push_str(val);
                        changed = true;
                    }
                }
                "forget" => {
                    if let Some(ref val) = action.value {
                        current_memory = current_memory.lines()
                            .filter(|line| !line.contains(val.as_str()))
                            .collect::<Vec<_>>()
                            .join("\n");
                        changed = true;
                    }
                }
                _ => {}
            }
        }
        if changed {
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES ('agent_memory', ?1)",
                [&current_memory],
            ).map_err(|e| e.to_string())?;
        }
    }

    // Enrich actions with task titles and filter out memory actions
    let filtered = AgentResponse {
        summary: result.summary.clone(),
        actions: result.actions.iter()
            .filter(|a| a.action != "remember" && a.action != "forget")
            .map(|a| {
                let mut enriched = a.clone();
                // Auto-generate description if missing
                if enriched.description.as_ref().map_or(true, |d| d.is_empty()) {
                    let task_title = a.task_id.as_ref().and_then(|tid| {
                        tasks.iter().find(|t| &t.id == tid).map(|t| t.title.clone())
                    });
                    enriched.description = Some(match a.action.as_str() {
                        "create" => format!("+ {}", a.value.as_deref().unwrap_or("")),
                        "delete" => format!("✕ {}", task_title.unwrap_or_default()),
                        "move" => format!("{} → {}", task_title.unwrap_or_default(), a.value.as_deref().unwrap_or("")),
                        "update" => format!("{}: {} = {}", task_title.unwrap_or_default(), a.field.as_deref().unwrap_or(""), a.value.as_deref().unwrap_or("")),
                        _ => a.value.clone().unwrap_or_default(),
                    });
                }
                enriched
            })
            .collect(),
    };

    eprintln!("[agent_chat] returning {} actions to frontend", filtered.actions.len());
    Ok(filtered)
}
