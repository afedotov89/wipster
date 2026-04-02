use tauri::State;

use crate::db::connection::DbState;
use crate::models::changelog::ChangeLogEntry;
use crate::services::undo_redo;

#[tauri::command]
pub fn undo_last(db: State<'_, DbState>) -> Result<Option<ChangeLogEntry>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let entry = undo_redo::get_last_undoable(&conn).map_err(|e| e.to_string())?;

    if let Some(ref e) = entry {
        undo_redo::apply_undo(&conn, e)?;
    }

    Ok(entry)
}

#[tauri::command]
pub fn redo_last(db: State<'_, DbState>) -> Result<Option<ChangeLogEntry>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let entry = undo_redo::get_last_redoable(&conn).map_err(|e| e.to_string())?;

    if let Some(ref e) = entry {
        undo_redo::apply_redo(&conn, e)?;
    }

    Ok(entry)
}

#[tauri::command]
pub fn get_changelog(
    db: State<'_, DbState>,
    limit: Option<i32>,
) -> Result<Vec<ChangeLogEntry>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(50);

    let mut stmt = conn
        .prepare(
            "SELECT id, created_at, actor, action, entity_type, entity_id, \
             old_value, new_value, undone, batch_id \
             FROM changelog ORDER BY created_at DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let entries = stmt
        .query_map([limit], |row| {
            Ok(ChangeLogEntry {
                id: row.get(0)?,
                created_at: row.get(1)?,
                actor: row.get(2)?,
                action: row.get(3)?,
                entity_type: row.get(4)?,
                entity_id: row.get(5)?,
                old_value: row.get(6)?,
                new_value: row.get(7)?,
                undone: row.get::<_, i32>(8)? != 0,
                batch_id: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(entries)
}
