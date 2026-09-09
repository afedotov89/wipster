use tauri::State;
use uuid::Uuid;

use crate::db::connection::DbState;
use crate::models::project::{CreateProjectInput, Project, UpdateProjectInput};
use crate::services::undo_redo;

/// Ceiling for a stored icon, data URL and all. A normalised 64px PNG lands
/// around 8 KB, so this leaves room for a detailed SVG without letting a photo
/// into the projects table.
const MAX_ICON_BYTES: usize = 128 * 1024;

#[tauri::command]
pub fn list_projects(db: State<'_, DbState>) -> Result<Vec<Project>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, parent_id, icon, icon_image, icon_mono, color, \"order\", created_at, updated_at \
             FROM projects ORDER BY \"order\" ASC, created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let projects = stmt
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get(2)?,
                icon: row.get(3)?,
                icon_image: row.get(4)?,
                icon_mono: row.get::<_, i32>(5)? != 0,
                color: row.get(6)?,
                order: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
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
        "INSERT INTO projects (id, name, \"order\", parent_id) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![id, input.name, max_order + 1, input.parent_id],
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
    if let Some(icon_image) = &input.icon_image {
        if let Some(data_url) = icon_image {
            validate_icon_image(data_url)?;
        }
        conn.execute(
            "UPDATE projects SET icon_image = ?1, updated_at = datetime('now') WHERE id = ?2",
            rusqlite::params![icon_image, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(icon_mono) = input.icon_mono {
        conn.execute(
            "UPDATE projects SET icon_mono = ?1, updated_at = datetime('now') WHERE id = ?2",
            rusqlite::params![icon_mono as i32, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(parent_id) = &input.parent_id {
        // A project that ends up inside its own subtree would make every
        // subtree query loop, so the move is refused rather than repaired.
        if let Some(new_parent) = parent_id {
            if crate::services::project_tree::would_create_cycle(&conn, &id, new_parent) {
                return Err("PROJECT_CYCLE".to_string());
            }
        }
        conn.execute(
            "UPDATE projects SET parent_id = ?1, updated_at = datetime('now') WHERE id = ?2",
            rusqlite::params![parent_id, id],
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

/// What deleting a project would take with it, so the confirmation can name
/// real numbers instead of a vague warning.
#[derive(serde::Serialize)]
pub struct ProjectDeleteImpact {
    /// Sub-projects that would be deleted along with it, at any depth.
    pub sub_projects: usize,
    /// Live tasks across that subtree — the ones that would be archived.
    pub tasks: usize,
}

#[tauri::command]
pub fn project_delete_impact(
    db: State<'_, DbState>,
    id: String,
) -> Result<ProjectDeleteImpact, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let ids = crate::services::project_tree::subtree_ids(&conn, &id);
    let placeholders = vec!["?"; ids.len()].join(", ");
    let params: Vec<&dyn rusqlite::types::ToSql> =
        ids.iter().map(|i| i as &dyn rusqlite::types::ToSql).collect();

    let tasks: i64 = conn
        .query_row(
            &format!(
                "SELECT COUNT(*) FROM tasks WHERE archived_at IS NULL AND project_id IN ({})",
                placeholders
            ),
            params.as_slice(),
            |r| r.get(0),
        )
        .unwrap_or(0);

    Ok(ProjectDeleteImpact {
        sub_projects: ids.len().saturating_sub(1),
        tasks: tasks as usize,
    })
}

/// Delete a project, its sub-projects at any depth, and archive every task in
/// that subtree.
///
/// Tasks are archived rather than deleted: the project is what the user asked
/// to remove, the work is not. Everything is recorded under one batch id, so a
/// single Cmd+Z brings back the projects *and* takes the tasks out of the
/// archive, and it all happens in one transaction so a failure half-way cannot
/// leave the board with tasks pointing at a project that no longer exists.
#[tauri::command]
pub fn delete_project(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    delete_project_subtree(&conn, &id)
}

fn delete_project_subtree(conn: &rusqlite::Connection, id: &str) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    let ids = crate::services::project_tree::subtree_ids(conn, id);
    let batch = Uuid::new_v4().to_string();

    // Tasks first: their "before" state is recorded while their project still
    // exists, which is what makes the undo able to put them back where they were.
    for project_id in &ids {
        let task_ids: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT id FROM tasks WHERE project_id = ?1 AND archived_at IS NULL")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([project_id], |row| row.get(0))
                .map_err(|e| e.to_string())?;
            rows.filter_map(|r| r.ok()).collect()
        };

        for task_id in task_ids {
            let before = crate::commands::task_commands::task_json(conn, &task_id)?;
            conn.execute(
                "UPDATE tasks SET archived_at = datetime('now'), updated_at = datetime('now') \
                 WHERE id = ?1",
                [&task_id],
            )
            .map_err(|e| e.to_string())?;
            let after = crate::commands::task_commands::task_json(conn, &task_id)?;
            undo_redo::record_change(
                conn, "update", "task", &task_id, Some(&before), Some(&after), Some(&batch),
            )
            .map_err(|e| e.to_string())?;
        }
    }

    // Then the projects, deepest first, so a child is never left pointing at a
    // parent that is already gone.
    for project_id in ids.iter().rev() {
        let project = get_project_by_id(conn, project_id)?;
        let project_json = serde_json::to_string(&project).map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM projects WHERE id = ?1", [project_id])
            .map_err(|e| e.to_string())?;
        undo_redo::record_change(
            conn, "delete", "project", project_id, Some(&project_json), None, Some(&batch),
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Guard on what may be stored as a project icon.
///
/// The icon travels inside every project row, so it has to stay small, and it
/// has to be an image: the UI renders it straight into an `img`/mask, and a
/// data URL of another type would simply render as nothing.
fn validate_icon_image(data_url: &str) -> Result<(), String> {
    if !data_url.starts_with("data:image/") {
        return Err("ICON_NOT_AN_IMAGE".to_string());
    }
    if data_url.len() > MAX_ICON_BYTES {
        return Err("ICON_TOO_LARGE".to_string());
    }
    Ok(())
}

fn get_project_by_id(conn: &rusqlite::Connection, id: &str) -> Result<Project, String> {
    conn.query_row(
        "SELECT id, name, parent_id, icon, icon_image, icon_mono, color, \"order\", created_at, updated_at \
         FROM projects WHERE id = ?1",
        [id],
        |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get(2)?,
                icon: row.get(3)?,
                icon_image: row.get(4)?,
                icon_mono: row.get::<_, i32>(5)? != 0,
                color: row.get(6)?,
                order: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        },
    )
    .map_err(|e| format!("Project not found: {}", e))
}

#[cfg(test)]
mod tests {
    use super::delete_project_subtree;
    use crate::db::connection::init_test_db;
    use crate::services::undo_redo;

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

    /// root ─ child, one live task in each, plus an untouched neighbour.
    fn tree_with_tasks() -> rusqlite::Connection {
        let conn = init_test_db();
        conn.execute_batch(
            "INSERT INTO projects (id, name) VALUES ('root', 'Root'), ('other', 'Other');
             INSERT INTO projects (id, name, parent_id) VALUES ('child', 'Child', 'root');
             INSERT INTO tasks (id, title, project_id, status) VALUES
               ('t-root', 'Root task', 'root', 'queue'),
               ('t-child', 'Child task', 'child', 'doing'),
               ('t-other', 'Other task', 'other', 'queue');",
        )
        .unwrap();
        conn
    }

    fn archived(conn: &rusqlite::Connection, id: &str) -> bool {
        conn.query_row(
            "SELECT archived_at IS NOT NULL FROM tasks WHERE id = ?1",
            [id],
            |r| r.get::<_, i32>(0),
        )
        .unwrap()
            == 1
    }

    #[test]
    fn an_icon_must_be_a_small_image() {
        use super::{validate_icon_image, MAX_ICON_BYTES};

        assert!(validate_icon_image("data:image/png;base64,iVBORw0KGgo=").is_ok());
        assert!(validate_icon_image("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=").is_ok());

        // Not an image at all.
        assert_eq!(
            validate_icon_image("data:text/html;base64,PHNjcmlwdD4=").unwrap_err(),
            "ICON_NOT_AN_IMAGE",
        );
        assert_eq!(
            validate_icon_image("https://example.com/logo.png").unwrap_err(),
            "ICON_NOT_AN_IMAGE",
        );

        // A photo-sized payload has no business in the projects table.
        let huge = format!("data:image/png;base64,{}", "A".repeat(MAX_ICON_BYTES));
        assert_eq!(validate_icon_image(&huge).unwrap_err(), "ICON_TOO_LARGE");
    }

    #[test]
    fn deleting_a_parent_takes_the_subtree_and_archives_its_tasks() {
        let conn = tree_with_tasks();
        delete_project_subtree(&conn, "root").unwrap();

        let projects: i32 = conn
            .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
            .unwrap();
        assert_eq!(projects, 1, "only the unrelated project survives");

        // The work is archived, never deleted.
        let tasks: i32 = conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(tasks, 3);
        assert!(archived(&conn, "t-root"));
        assert!(archived(&conn, "t-child"));
        assert!(!archived(&conn, "t-other"), "a neighbour is untouched");
    }

    #[test]
    fn one_undo_brings_back_the_projects_and_the_tasks() {
        let conn = tree_with_tasks();
        delete_project_subtree(&conn, "root").unwrap();

        let batch = undo_redo::get_undo_batch(&conn).unwrap();
        assert_eq!(batch.len(), 4, "2 tasks archived + 2 projects deleted");
        for entry in &batch {
            undo_redo::apply_undo(&conn, entry).unwrap();
        }

        let projects: i32 = conn
            .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
            .unwrap();
        assert_eq!(projects, 3, "root, child and the neighbour are all back");

        let parent: Option<String> = conn
            .query_row("SELECT parent_id FROM projects WHERE id = 'child'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(parent.as_deref(), Some("root"), "the nesting is restored");

        assert!(!archived(&conn, "t-root"));
        assert!(!archived(&conn, "t-child"));
        let project: Option<String> = conn
            .query_row("SELECT project_id FROM tasks WHERE id = 't-child'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(project.as_deref(), Some("child"), "the task is back in its project");
    }

    #[test]
    fn deleting_a_child_leaves_the_parent_alone() {
        let conn = tree_with_tasks();
        delete_project_subtree(&conn, "child").unwrap();

        let root_exists: i32 = conn
            .query_row("SELECT COUNT(*) FROM projects WHERE id = 'root'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(root_exists, 1);
        assert!(archived(&conn, "t-child"));
        assert!(!archived(&conn, "t-root"), "the parent's own tasks stay live");
    }
}
