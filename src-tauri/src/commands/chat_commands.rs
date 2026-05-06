use tauri::State;
use uuid::Uuid;

use crate::db::connection::DbState;
use crate::models::chat::{ChatMessage, ChatSession};
use crate::services::agent::{PendingToolCall, ToolCallLog};

#[tauri::command]
pub fn create_chat_session(db: State<'_, DbState>) -> Result<ChatSession, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO chat_sessions (id) VALUES (?1)",
        [&id],
    )
    .map_err(|e| e.to_string())?;

    conn.query_row(
        "SELECT id, title, created_at FROM chat_sessions WHERE id = ?1",
        [&id],
        |row| {
            Ok(ChatSession {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_chat_sessions(db: State<'_, DbState>) -> Result<Vec<ChatSession>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, title, created_at FROM chat_sessions ORDER BY created_at DESC LIMIT 50")
        .map_err(|e| e.to_string())?;

    let sessions = stmt
        .query_map([], |row| {
            Ok(ChatSession {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(sessions)
}

#[tauri::command]
pub fn get_chat_messages(
    db: State<'_, DbState>,
    session_id: String,
) -> Result<Vec<ChatMessage>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, role, text, actions_json, executed, \
                    pending_confirmations_json, confirmation_status, created_at \
             FROM chat_messages WHERE session_id = ?1 ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let messages = stmt
        .query_map([&session_id], |row| {
            let actions_json: Option<String> = row.get(4)?;
            let actions: Option<Vec<ToolCallLog>> = actions_json
                .and_then(|j| serde_json::from_str(&j).ok());
            let executed: i32 = row.get(5)?;
            let pending_json: Option<String> = row.get(6)?;
            let pending: Option<Vec<PendingToolCall>> = pending_json
                .and_then(|j| serde_json::from_str(&j).ok());
            let confirmation_status: Option<String> = row.get(7)?;

            Ok(ChatMessage {
                id: row.get(0)?,
                session_id: row.get(1)?,
                role: row.get(2)?,
                text: row.get(3)?,
                tool_calls: actions,
                executed: executed != 0,
                pending_confirmations: pending,
                confirmation_status,
                created_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(messages)
}

#[tauri::command]
pub fn add_chat_message(
    db: State<'_, DbState>,
    session_id: String,
    role: String,
    text: String,
    actions_json: Option<String>,
    executed: bool,
    pending_confirmations_json: Option<String>,
    confirmation_status: Option<String>,
) -> Result<ChatMessage, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO chat_messages (id, session_id, role, text, actions_json, executed, \
                                    pending_confirmations_json, confirmation_status) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![id, session_id, role, text, actions_json, executed as i32,
                          pending_confirmations_json, confirmation_status],
    )
    .map_err(|e| e.to_string())?;

    // Auto-set session title from first user message
    if role == "user" {
        let title: String = text.chars().take(80).collect();
        conn.execute(
            "UPDATE chat_sessions SET title = ?1 WHERE id = ?2 AND title = ''",
            rusqlite::params![title, session_id],
        )
        .map_err(|e| e.to_string())?;
    }

    let actions: Option<Vec<ToolCallLog>> = actions_json
        .and_then(|j| serde_json::from_str(&j).ok());
    let pending: Option<Vec<PendingToolCall>> = pending_confirmations_json
        .and_then(|j| serde_json::from_str(&j).ok());

    conn.query_row(
        "SELECT id, session_id, role, text, executed, confirmation_status, created_at \
         FROM chat_messages WHERE id = ?1",
        [&id],
        |row| {
            let exec: i32 = row.get(4)?;
            Ok(ChatMessage {
                id: row.get(0)?,
                session_id: row.get(1)?,
                role: row.get(2)?,
                text: row.get(3)?,
                tool_calls: actions,
                executed: exec != 0,
                pending_confirmations: pending,
                confirmation_status: row.get(5)?,
                created_at: row.get(6)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_chat_message(
    db: State<'_, DbState>,
    id: String,
    executed: bool,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE chat_messages SET executed = ?1 WHERE id = ?2",
        rusqlite::params![executed as i32, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_chat_confirmation(
    db: State<'_, DbState>,
    id: String,
    status: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE chat_messages SET confirmation_status = ?1 WHERE id = ?2",
        rusqlite::params![status, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_chat_session(
    db: State<'_, DbState>,
    session_id: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM chat_sessions WHERE id = ?1", [&session_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
