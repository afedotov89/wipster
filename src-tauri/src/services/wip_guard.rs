use rusqlite::Connection;

use crate::models::task::Task;

pub const WIP_LIMIT: usize = 3;

pub struct WipCheckResult {
    pub allowed: bool,
    pub doing_tasks: Vec<Task>,
}

pub fn check_wip(conn: &Connection, exclude_task_id: Option<&str>) -> WipCheckResult {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, project_id, status, priority, due, estimate, time_estimate, tags, \
             dod, checklist, next_step, return_ref, promised_to, comment, position, created_at, updated_at \
             FROM tasks WHERE status = 'doing'",
        )
        .expect("Failed to prepare WIP check query");

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
                comment: row.get(14)?, position: row.get(15)?,
                created_at: row.get(16)?,
                updated_at: row.get(17)?,
            })
        })
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
