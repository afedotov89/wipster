use rusqlite::Connection;

use crate::models::task::{task_from_row, Task, TASK_COLUMNS};

pub const WIP_LIMIT: usize = 3;

pub struct WipCheckResult {
    pub allowed: bool,
    pub doing_tasks: Vec<Task>,
}

pub fn check_wip(conn: &Connection, exclude_task_id: Option<&str>) -> WipCheckResult {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {} FROM tasks WHERE status = 'doing' AND archived_at IS NULL",
            TASK_COLUMNS
        ))
        .expect("Failed to prepare WIP check query");

    let tasks: Vec<Task> = stmt
        .query_map([], task_from_row)
        .expect("Failed to query doing tasks")
        .filter_map(|r| r.ok())
        .collect();

    let count = match exclude_task_id {
        Some(id) => tasks.iter().filter(|t| t.id != id).count(),
        None => tasks.len(),
    };

    WipCheckResult {
        allowed: count < WIP_LIMIT,
        doing_tasks: tasks,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connection::init_test_db;

    #[test]
    fn test_wip_allowed_when_empty() {
        let conn = init_test_db();
        let result = check_wip(&conn, None);
        assert!(result.allowed);
        assert!(result.doing_tasks.is_empty());
    }

    #[test]
    fn test_wip_blocked_at_limit() {
        let conn = init_test_db();

        // Create a project first
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

        let result = check_wip(&conn, None);
        assert!(!result.allowed);
        assert_eq!(result.doing_tasks.len(), 3);
    }

    #[test]
    fn test_archived_tasks_do_not_consume_wip() {
        let conn = init_test_db();

        conn.execute("INSERT INTO projects (id, name) VALUES ('p1', 'Test')", [])
            .unwrap();

        for i in 0..3 {
            conn.execute(
                "INSERT INTO tasks (id, title, project_id, status) VALUES (?1, ?2, 'p1', 'doing')",
                rusqlite::params![format!("t{}", i), format!("Task {}", i)],
            )
            .unwrap();
        }
        conn.execute(
            "UPDATE tasks SET archived_at = datetime('now') WHERE id = 't0'",
            [],
        )
        .unwrap();

        let result = check_wip(&conn, None);
        assert!(result.allowed);
        assert_eq!(result.doing_tasks.len(), 2);
    }

    #[test]
    fn test_wip_allowed_with_exclude() {
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

        let result = check_wip(&conn, Some("t0"));
        assert!(result.allowed);
    }
}
