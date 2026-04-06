use tauri::State;
use uuid::Uuid;

use crate::db::connection::DbState;
use crate::models::task::{CreateTaskInput, MoveTaskInput, Task, TaskStatus, UpdateTaskInput};
use crate::services::{undo_redo, wip_guard};

#[tauri::command]
pub fn list_tasks(
    db: State<'_, DbState>,
    project_id: Option<String>,
    status: Option<String>,
) -> Result<Vec<Task>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let mut sql = String::from(
        "SELECT id, title, project_id, status, priority, due, estimate, time_estimate, tags, \
         dod, checklist, next_step, return_ref, promised_to, comment, position, created_at, updated_at FROM tasks WHERE 1=1",
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

    sql.push_str(" ORDER BY \
        COALESCE(position, 999999) ASC, \
        CASE priority WHEN 'p0' THEN 0 WHEN 'p1' THEN 1 WHEN 'p2' THEN 2 WHEN 'p3' THEN 3 ELSE 4 END ASC, \
        created_at DESC");

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let tasks = stmt
        .query_map(param_refs.as_slice(), |row| {
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
                comment: row.get(14)?, position: row.get(15)?,
                created_at: row.get(16)?,
                updated_at: row.get(17)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(tasks)
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

    conn.execute(
        "INSERT INTO tasks (id, title, project_id, status) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![id, input.title, input.project_id, status],
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

    conn.execute(
        "UPDATE tasks SET status = ?1, updated_at = datetime('now') WHERE id = ?2",
        rusqlite::params![input.new_status, input.task_id],
    )
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
         FROM tasks WHERE project_id IS NOT NULL GROUP BY project_id"
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
        "SELECT id, title, project_id, status, priority, due, estimate, time_estimate, tags, \
         dod, checklist, next_step, return_ref, promised_to, comment, position, created_at, updated_at \
         FROM tasks WHERE id = ?1",
        [id],
        |row| {
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
                comment: row.get(14)?, position: row.get(15)?,
                created_at: row.get(16)?,
                updated_at: row.get(17)?,
            })
        },
    )
    .map_err(|e| format!("Task not found: {}", e))
}

#[cfg(test)]
mod tests {
    use crate::db::connection::init_test_db;

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
