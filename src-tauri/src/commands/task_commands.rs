use tauri::State;
use uuid::Uuid;

use crate::db::connection::DbState;
use crate::models::task::{
    task_from_row, CreateTaskInput, MoveTaskInput, Task, TaskStatus, UpdateTaskInput, TASK_COLUMNS,
};
use crate::services::{undo_redo, wip_guard};

/// Position that places a task above every other task in its column.
/// Columns are (project_id, status) pairs; `reorder_tasks` renumbers them from 0
/// on the next drag, so drifting into negatives is harmless.
fn top_position(conn: &rusqlite::Connection, project_id: Option<&str>, status: &str) -> i32 {
    conn.query_row(
        "SELECT COALESCE(MIN(position), 0) - 1 FROM tasks \
         WHERE project_id IS ?1 AND status = ?2 AND archived_at IS NULL",
        rusqlite::params![project_id, status],
        |row| row.get(0),
    )
    .unwrap_or(-1)
}

#[tauri::command]
pub fn list_tasks(
    db: State<'_, DbState>,
    project_id: Option<String>,
    status: Option<String>,
) -> Result<Vec<Task>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let mut sql = format!(
        "SELECT {} FROM tasks WHERE archived_at IS NULL",
        TASK_COLUMNS
    );
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref pid) = project_id {
        sql.push_str(" AND project_id = ?");
        params.push(Box::new(pid.clone()));
    }
    if let Some(ref s) = status {
        sql.push_str(" AND status = ?");
        params.push(Box::new(s.clone()));
    }

    // Priority/due/energy stay the leading keys. A freshly created task is held on
    // top of the board by the client until the next reload; `position` is what it
    // settles into then — the top of its sort group rather than the bottom.
    sql.push_str(" ORDER BY \
        CASE priority WHEN 'p0' THEN 0 WHEN 'p1' THEN 1 WHEN 'p2' THEN 2 WHEN 'p3' THEN 3 ELSE 4 END ASC, \
        CASE WHEN due IS NULL THEN 1 ELSE 0 END ASC, due ASC, \
        CASE energy WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END ASC, \
        COALESCE(position, 999999) ASC, \
        created_at ASC");

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let tasks = stmt
        .query_map(param_refs.as_slice(), task_from_row)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(tasks)
}

/// Archived tasks across all projects, most recently archived first.
#[tauri::command]
pub fn list_archived_tasks(db: State<'_, DbState>) -> Result<Vec<Task>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let sql = format!(
        "SELECT {} FROM tasks WHERE archived_at IS NOT NULL ORDER BY archived_at DESC",
        TASK_COLUMNS
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let tasks = stmt
        .query_map([], task_from_row)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(tasks)
}

/// Move a task into the archive, or restore it back onto the board.
/// A restored task returns to the status it had when archived (falling back to
/// `queue` if `doing` is at the WIP limit) and lands on top of that column.
#[tauri::command]
pub fn set_task_archived(
    db: State<'_, DbState>,
    id: String,
    archived: bool,
) -> Result<Task, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let old = get_task_by_id(&conn, &id)?;
    let old_json = serde_json::to_string(&old).map_err(|e| e.to_string())?;

    if archived {
        conn.execute(
            "UPDATE tasks SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?1",
            [&id],
        )
        .map_err(|e| e.to_string())?;
    } else {
        // A task archived while in progress can only come back if there is WIP room.
        let status = if old.status == "doing" && !wip_guard::check_wip(&conn, Some(&id)).allowed {
            "queue".to_string()
        } else {
            old.status.clone()
        };
        let position = top_position(&conn, old.project_id.as_deref(), &status);

        conn.execute(
            "UPDATE tasks SET archived_at = NULL, status = ?1, position = ?2, updated_at = datetime('now') WHERE id = ?3",
            rusqlite::params![status, position, id],
        )
        .map_err(|e| e.to_string())?;
    }

    let updated = get_task_by_id(&conn, &id)?;
    let new_json = serde_json::to_string(&updated).map_err(|e| e.to_string())?;

    undo_redo::record_change(
        &conn,
        "update",
        "task",
        &id,
        Some(&old_json),
        Some(&new_json),
        None,
    )
    .map_err(|e| e.to_string())?;

    Ok(updated)
}

#[tauri::command]
pub fn create_task(db: State<'_, DbState>, input: CreateTaskInput) -> Result<Task, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let status = input.status.unwrap_or_else(|| "queue".to_string());

    TaskStatus::from_str(&status)?;

    if status == "doing" {
        let wip = wip_guard::check_wip(&conn, None);
        if !wip.allowed {
            return Err("WIP_LIMIT_REACHED".to_string());
        }
    }

    let position = top_position(&conn, input.project_id.as_deref(), &status);

    conn.execute(
        "INSERT INTO tasks (id, title, project_id, status, position) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![id, input.title, input.project_id, status, position],
    )
    .map_err(|e| e.to_string())?;

    let task = get_task_by_id(&conn, &id)?;
    let json = serde_json::to_string(&task).map_err(|e| e.to_string())?;

    undo_redo::record_change(&conn, "create", "task", &id, None, Some(&json), None)
        .map_err(|e| e.to_string())?;

    Ok(task)
}

#[tauri::command]
pub fn get_task(db: State<'_, DbState>, id: String) -> Result<Task, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    get_task_by_id(&conn, &id)
}

#[tauri::command]
pub fn update_task(
    db: State<'_, DbState>,
    id: String,
    input: UpdateTaskInput,
) -> Result<Task, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let old = get_task_by_id(&conn, &id)?;
    let old_json = serde_json::to_string(&old).map_err(|e| e.to_string())?;

    let mut updates = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    macro_rules! add_field {
        ($field:ident, $col:expr) => {
            if let Some(ref val) = input.$field {
                updates.push(format!("{} = ?", $col));
                if val.is_empty() {
                    params.push(Box::new(None::<String>));
                } else {
                    params.push(Box::new(val.clone()));
                }
            }
        };
    }

    add_field!(title, "title");
    add_field!(project_id, "project_id");
    add_field!(status, "status");
    add_field!(priority, "priority");
    add_field!(energy, "energy");
    add_field!(due, "due");
    add_field!(estimate, "estimate");
    add_field!(time_estimate, "time_estimate");
    add_field!(tags, "tags");
    add_field!(dod, "dod");
    add_field!(checklist, "checklist");
    add_field!(next_step, "next_step");
    add_field!(return_ref, "return_ref");
    add_field!(promised_to, "promised_to");
    add_field!(comment, "comment");
    add_field!(tracker_url, "tracker_url");

    if updates.is_empty() {
        return Ok(old);
    }

    if let Some(ref new_status) = input.status {
        if new_status == "doing" && old.status != "doing" {
            let wip = wip_guard::check_wip(&conn, Some(&id));
            if !wip.allowed {
                return Err("WIP_LIMIT_REACHED".to_string());
            }
        }
    }

    // Set completed_at when moving to done, clear when leaving done
    if let Some(ref new_status) = input.status {
        if new_status == "done" && old.status != "done" {
            updates.push("completed_at = datetime('now')".to_string());
        } else if new_status != "done" && old.status == "done" {
            updates.push("completed_at = NULL".to_string());
        }
    }

    updates.push("updated_at = datetime('now')".to_string());
    params.push(Box::new(id.clone()));

    let sql = format!(
        "UPDATE tasks SET {} WHERE id = ?",
        updates.join(", ")
    );
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    conn.execute(&sql, param_refs.as_slice())
        .map_err(|e| e.to_string())?;

    let updated = get_task_by_id(&conn, &id)?;
    let new_json = serde_json::to_string(&updated).map_err(|e| e.to_string())?;

    undo_redo::record_change(
        &conn,
        "update",
        "task",
        &id,
        Some(&old_json),
        Some(&new_json),
        None,
    )
    .map_err(|e| e.to_string())?;

    Ok(updated)
}

#[tauri::command]
pub fn delete_task(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let old = get_task_by_id(&conn, &id)?;
    let old_json = serde_json::to_string(&old).map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM tasks WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    undo_redo::record_change(&conn, "delete", "task", &id, Some(&old_json), None, None)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[derive(serde::Serialize)]
pub struct MoveTaskResult {
    pub task: Task,
    pub wip_blocked: bool,
    pub doing_tasks: Vec<Task>,
}

#[tauri::command]
pub fn move_task(db: State<'_, DbState>, input: MoveTaskInput) -> Result<MoveTaskResult, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    TaskStatus::from_str(&input.new_status)?;

    let old = get_task_by_id(&conn, &input.task_id)?;
    let old_json = serde_json::to_string(&old).map_err(|e| e.to_string())?;

    if input.new_status == "doing" && old.status != "doing" {
        let wip = wip_guard::check_wip(&conn, Some(&input.task_id));
        if !wip.allowed {
            if let Some(swap_id) = &input.swap_task_id {
                // Swap: move the swap task back to queue
                let swap_old = get_task_by_id(&conn, swap_id)?;
                let swap_old_json =
                    serde_json::to_string(&swap_old).map_err(|e| e.to_string())?;

                conn.execute(
                    "UPDATE tasks SET status = 'queue', updated_at = datetime('now') WHERE id = ?1",
                    [swap_id],
                )
                .map_err(|e| e.to_string())?;

                let swap_updated = get_task_by_id(&conn, swap_id)?;
                let swap_new_json =
                    serde_json::to_string(&swap_updated).map_err(|e| e.to_string())?;

                undo_redo::record_change(
                    &conn,
                    "update",
                    "task",
                    swap_id,
                    Some(&swap_old_json),
                    Some(&swap_new_json),
                    None,
                )
                .map_err(|e| e.to_string())?;
            } else {
                return Ok(MoveTaskResult {
                    task: old,
                    wip_blocked: true,
                    doing_tasks: wip.doing_tasks,
                });
            }
        }
    }

    let move_sql = if input.new_status == "done" {
        "UPDATE tasks SET status = ?1, completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?2"
    } else {
        "UPDATE tasks SET status = ?1, completed_at = NULL, updated_at = datetime('now') WHERE id = ?2"
    };
    conn.execute(move_sql, rusqlite::params![input.new_status, input.task_id])
    .map_err(|e| e.to_string())?;

    let updated = get_task_by_id(&conn, &input.task_id)?;
    let new_json = serde_json::to_string(&updated).map_err(|e| e.to_string())?;

    undo_redo::record_change(
        &conn,
        "update",
        "task",
        &input.task_id,
        Some(&old_json),
        Some(&new_json),
        None,
    )
    .map_err(|e| e.to_string())?;

    Ok(MoveTaskResult {
        task: updated,
        wip_blocked: false,
        doing_tasks: vec![],
    })
}

#[tauri::command]
pub fn get_promised_to_options(db: State<'_, DbState>) -> Result<Vec<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT promised_to, COUNT(*) as cnt FROM tasks \
             WHERE promised_to IS NOT NULL AND promised_to != '' \
             GROUP BY promised_to ORDER BY cnt DESC",
        )
        .map_err(|e| e.to_string())?;

    let options = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(options)
}

#[tauri::command]
pub fn get_estimate_options(db: State<'_, DbState>) -> Result<Vec<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT time_estimate FROM tasks \
             WHERE time_estimate IS NOT NULL AND time_estimate != '' \
             GROUP BY time_estimate ORDER BY COUNT(*) DESC",
        )
        .map_err(|e| e.to_string())?;

    let options = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(options)
}

#[derive(serde::Serialize)]
pub struct ProjectTaskCounts {
    pub project_id: String,
    pub queue: i32,
    pub doing: i32,
    pub done: i32,
}

#[tauri::command]
pub fn get_project_task_counts(db: State<'_, DbState>) -> Result<Vec<ProjectTaskCounts>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT project_id, \
         SUM(CASE WHEN status = 'queue' THEN 1 ELSE 0 END), \
         SUM(CASE WHEN status = 'doing' THEN 1 ELSE 0 END), \
         SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) \
         FROM tasks WHERE project_id IS NOT NULL AND archived_at IS NULL GROUP BY project_id"
    ).map_err(|e| e.to_string())?;

    let counts = stmt.query_map([], |row| {
        Ok(ProjectTaskCounts {
            project_id: row.get(0)?,
            queue: row.get(1)?,
            doing: row.get(2)?,
            done: row.get(3)?,
        })
    }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();

    Ok(counts)
}

/// Update positions of tasks within a column. `task_ids` is the ordered list.
#[tauri::command]
pub fn reorder_tasks(db: State<'_, DbState>, task_ids: Vec<String>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    for (pos, id) in task_ids.iter().enumerate() {
        conn.execute(
            "UPDATE tasks SET position = ?1, updated_at = datetime('now') WHERE id = ?2",
            rusqlite::params![pos as i32, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_doing_tasks(db: State<'_, DbState>) -> Result<Vec<Task>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let wip = wip_guard::check_wip(&conn, None);
    Ok(wip.doing_tasks)
}

fn get_task_by_id(conn: &rusqlite::Connection, id: &str) -> Result<Task, String> {
    conn.query_row(
        &format!("SELECT {} FROM tasks WHERE id = ?1", TASK_COLUMNS),
        [id],
        task_from_row,
    )
    .map_err(|e| format!("Task not found: {}", e))
}

#[cfg(test)]
mod tests {
    use super::top_position;
    use crate::db::connection::init_test_db;

    #[test]
    fn test_top_position_is_above_every_task_in_the_column() {
        let conn = init_test_db();
        conn.execute("INSERT INTO projects (id, name) VALUES ('p1', 'Test')", [])
            .unwrap();

        // Empty column — first task still gets a position, so later ones can go above it.
        assert_eq!(top_position(&conn, Some("p1"), "queue"), -1);

        for (id, pos) in [("t0", 0), ("t1", 1), ("t2", 2)] {
            conn.execute(
                "INSERT INTO tasks (id, title, project_id, status, position) VALUES (?1, ?1, 'p1', 'queue', ?2)",
                rusqlite::params![id, pos],
            )
            .unwrap();
        }
        assert_eq!(top_position(&conn, Some("p1"), "queue"), -1);

        // Other columns and other projects are independent.
        assert_eq!(top_position(&conn, Some("p1"), "doing"), -1);
        assert_eq!(top_position(&conn, None, "queue"), -1);

        // Repeated quick-adds keep stacking on top.
        conn.execute(
            "INSERT INTO tasks (id, title, project_id, status, position) VALUES ('t3', 't3', 'p1', 'queue', -1)",
            [],
        )
        .unwrap();
        assert_eq!(top_position(&conn, Some("p1"), "queue"), -2);
    }

    #[test]
    fn test_top_position_ignores_archived_tasks() {
        let conn = init_test_db();
        conn.execute("INSERT INTO projects (id, name) VALUES ('p1', 'Test')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO tasks (id, title, project_id, status, position, archived_at) \
             VALUES ('a1', 'archived', 'p1', 'queue', -50, datetime('now'))",
            [],
        )
        .unwrap();

        assert_eq!(top_position(&conn, Some("p1"), "queue"), -1);
    }

    #[test]
    fn test_task_crud() {
        let conn = init_test_db();

        conn.execute(
            "INSERT INTO projects (id, name) VALUES ('p1', 'Test')",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO tasks (id, title, project_id, status) VALUES ('t1', 'My Task', 'p1', 'queue')",
            [],
        )
        .unwrap();

        let title: String = conn
            .query_row("SELECT title FROM tasks WHERE id = 't1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "My Task");

        conn.execute(
            "UPDATE tasks SET status = 'doing' WHERE id = 't1'",
            [],
        )
        .unwrap();

        let status: String = conn
            .query_row("SELECT status FROM tasks WHERE id = 't1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(status, "doing");
    }

    #[test]
    fn test_wip_limit_in_sql() {
        let conn = init_test_db();

        conn.execute(
            "INSERT INTO projects (id, name) VALUES ('p1', 'Test')",
            [],
        )
        .unwrap();

        for i in 0..3 {
            conn.execute(
                "INSERT INTO tasks (id, title, project_id, status) VALUES (?1, ?2, 'p1', 'doing')",
                rusqlite::params![format!("t{}", i), format!("Task {}", i)],
            )
            .unwrap();
        }

        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE status = 'doing'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 3);
    }
}
