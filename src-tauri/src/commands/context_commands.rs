use tauri::State;
use uuid::Uuid;

use crate::db::connection::DbState;
use crate::models::context_snapshot::ContextSnapshot;
use crate::services::context_capture;

#[tauri::command]
pub fn capture_context(
    db: State<'_, DbState>,
    task_id: Option<String>,
) -> Result<ContextSnapshot, String> {
    let mut snapshot = context_capture::capture_current_context();
    snapshot.task_id = task_id.clone();

    if snapshot.id.is_empty() {
        snapshot.id = Uuid::new_v4().to_string();
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO context_snapshots (id, task_id, captured_at, app, window_title, url, repo, branch, file_path, note) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            snapshot.id,
            snapshot.task_id,
            snapshot.captured_at,
            snapshot.app,
            snapshot.window_title,
            snapshot.url,
            snapshot.repo,
            snapshot.branch,
            snapshot.file_path,
            snapshot.note,
        ],
    )
    .map_err(|e| e.to_string())?;

    // If task_id provided, store as return_ref on the task
    if let Some(ref tid) = task_id {
        let ref_json = serde_json::to_string(&snapshot).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE tasks SET return_ref = ?1, updated_at = datetime('now') WHERE id = ?2",
            rusqlite::params![ref_json, tid],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(snapshot)
}

#[tauri::command]
pub fn get_task_contexts(
    db: State<'_, DbState>,
    task_id: String,
) -> Result<Vec<ContextSnapshot>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, task_id, captured_at, app, window_title, url, repo, branch, file_path, note \
             FROM context_snapshots WHERE task_id = ?1 ORDER BY captured_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let snapshots = stmt
        .query_map([&task_id], |row| {
            Ok(ContextSnapshot {
                id: row.get(0)?,
                task_id: row.get(1)?,
                captured_at: row.get(2)?,
                app: row.get(3)?,
                window_title: row.get(4)?,
                url: row.get(5)?,
                repo: row.get(6)?,
                branch: row.get(7)?,
                file_path: row.get(8)?,
                note: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(snapshots)
}
