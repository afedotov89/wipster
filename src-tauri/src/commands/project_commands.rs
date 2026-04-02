use tauri::State;
use uuid::Uuid;

use crate::db::connection::DbState;
use crate::models::project::{CreateProjectInput, Project, UpdateProjectInput};
use crate::services::undo_redo;

#[tauri::command]
pub fn list_projects(db: State<'_, DbState>) -> Result<Vec<Project>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, icon, color, \"order\", created_at, updated_at \
             FROM projects ORDER BY \"order\" ASC, created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let projects = stmt
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

    Ok(projects)
}

#[tauri::command]
pub fn create_project(db: State<'_, DbState>, input: CreateProjectInput) -> Result<Project, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();

    let max_order: i32 = conn
        .query_row("SELECT COALESCE(MAX(\"order\"), -1) FROM projects", [], |r| {
            r.get(0)
        })
        .unwrap_or(-1);

    conn.execute(
        "INSERT INTO projects (id, name, \"order\") VALUES (?1, ?2, ?3)",
        rusqlite::params![id, input.name, max_order + 1],
    )
    .map_err(|e| e.to_string())?;

    let project = get_project_by_id(&conn, &id)?;

    let json = serde_json::to_string(&project).map_err(|e| e.to_string())?;
    undo_redo::record_change(&conn, "create", "project", &id, None, Some(&json), None)
        .map_err(|e| e.to_string())?;

    Ok(project)
}

#[tauri::command]
pub fn update_project(
    db: State<'_, DbState>,
    id: String,
    input: UpdateProjectInput,
) -> Result<Project, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let old = get_project_by_id(&conn, &id)?;
    let old_json = serde_json::to_string(&old).map_err(|e| e.to_string())?;

    if let Some(name) = &input.name {
        conn.execute(
            "UPDATE projects SET name = ?1, updated_at = datetime('now') WHERE id = ?2",
            rusqlite::params![name, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(icon) = &input.icon {
        conn.execute(
            "UPDATE projects SET icon = ?1, updated_at = datetime('now') WHERE id = ?2",
            rusqlite::params![icon, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(color) = &input.color {
        conn.execute(
            "UPDATE projects SET color = ?1, updated_at = datetime('now') WHERE id = ?2",
            rusqlite::params![color, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(order) = input.order {
        conn.execute(
            "UPDATE projects SET \"order\" = ?1, updated_at = datetime('now') WHERE id = ?2",
            rusqlite::params![order, id],
        )
        .map_err(|e| e.to_string())?;
    }

    let updated = get_project_by_id(&conn, &id)?;
    let new_json = serde_json::to_string(&updated).map_err(|e| e.to_string())?;

    undo_redo::record_change(
        &conn,
        "update",
        "project",
        &id,
        Some(&old_json),
        Some(&new_json),
        None,
    )
    .map_err(|e| e.to_string())?;

    Ok(updated)
}

#[tauri::command]
pub fn delete_project(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let old = get_project_by_id(&conn, &id)?;
    let old_json = serde_json::to_string(&old).map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM projects WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    undo_redo::record_change(&conn, "delete", "project", &id, Some(&old_json), None, None)
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn get_project_by_id(conn: &rusqlite::Connection, id: &str) -> Result<Project, String> {
    conn.query_row(
        "SELECT id, name, icon, color, \"order\", created_at, updated_at FROM projects WHERE id = ?1",
        [id],
        |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                icon: row.get(2)?,
                color: row.get(3)?,
                order: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    )
    .map_err(|e| format!("Project not found: {}", e))
}

#[cfg(test)]
mod tests {
    use crate::db::connection::init_test_db;

    #[test]
    fn test_project_crud() {
        let conn = init_test_db();

        // Create
        conn.execute(
            "INSERT INTO projects (id, name, \"order\") VALUES ('p1', 'My Project', 0)",
            [],
        )
        .unwrap();

        // Read
        let name: String = conn
            .query_row("SELECT name FROM projects WHERE id = 'p1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(name, "My Project");

        // Update
        conn.execute(
            "UPDATE projects SET name = 'Updated' WHERE id = 'p1'",
            [],
        )
        .unwrap();
        let name: String = conn
            .query_row("SELECT name FROM projects WHERE id = 'p1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(name, "Updated");

        // Delete
        conn.execute("DELETE FROM projects WHERE id = 'p1'", [])
            .unwrap();
        let count: i32 = conn
            .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }
}
