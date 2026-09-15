use tauri::State;

use crate::db::connection::DbState;
use crate::services::task_fields::{self, Kind, TaskField, ALL_KINDS};

/// A type a custom field can have, with the name the picker shows.
#[derive(serde::Serialize)]
pub struct FieldKind {
    pub id: &'static str,
    /// Whether values of this type are a list — the editors differ that much.
    pub list: bool,
}

#[tauri::command]
pub fn task_field_kinds() -> Vec<FieldKind> {
    ALL_KINDS
        .iter()
        .map(|kind| FieldKind { id: kind.as_str(), list: kind.is_list() })
        .collect()
}

#[tauri::command]
pub fn list_task_fields(db: State<'_, DbState>) -> Result<Vec<TaskField>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    task_fields::list(&conn)
}

/// Custom fields taken out of the list that still hold values.
#[tauri::command]
pub fn removed_task_fields(db: State<'_, DbState>) -> Result<Vec<TaskField>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    task_fields::removed_with_values(&conn)
}

#[tauri::command]
pub fn create_task_field(
    db: State<'_, DbState>,
    label: String,
    kind: String,
    options: Option<Vec<String>>,
) -> Result<TaskField, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    task_fields::create(&conn, &label, Kind::parse(&kind)?, &options.unwrap_or_default())
}

#[tauri::command]
pub fn update_task_field(
    db: State<'_, DbState>,
    id: String,
    label: Option<String>,
    enabled: Option<bool>,
    options: Option<Vec<String>>,
    // Tauri maps the caller's `columnSide` onto this.
    column_side: Option<String>,
) -> Result<TaskField, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    task_fields::update(
        &conn,
        &id,
        label.as_deref(),
        enabled,
        options.as_deref(),
        column_side.as_deref(),
    )
}

#[tauri::command]
pub fn reorder_task_fields(db: State<'_, DbState>, ids: Vec<String>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    task_fields::reorder(&conn, &ids)
}

/// Take a custom field out of the list. What it holds stays in the database.
#[tauri::command]
pub fn remove_task_field(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    task_fields::remove(&conn, &id)
}

#[tauri::command]
pub fn restore_task_field(db: State<'_, DbState>, id: String) -> Result<TaskField, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    task_fields::restore(&conn, &id)
}

#[tauri::command]
pub fn task_field_values(
    db: State<'_, DbState>,
    task_id: String,
) -> Result<serde_json::Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    task_fields::values(&conn, &task_id)
}

#[tauri::command]
pub fn set_task_field_value(
    db: State<'_, DbState>,
    task_id: String,
    field_id: String,
    value: serde_json::Value,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    task_fields::set_value(&conn, &task_id, &field_id, &value)
}
