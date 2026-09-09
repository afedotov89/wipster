use rusqlite::Connection;

use crate::models::task::{task_from_row, Task, TASK_COLUMNS};

/// How many tasks may sit in `doing` unless the user says otherwise. The whole
/// point of the app is that this number is small.
pub const DEFAULT_WIP_LIMIT: usize = 3;

/// Guard rails for the stored setting: zero would make `doing` unusable, and a
/// huge number is the same as having no limit at all.
pub const MIN_WIP_LIMIT: usize = 1;
pub const MAX_WIP_LIMIT: usize = 20;

pub struct WipCheckResult {
    pub allowed: bool,
    pub doing_tasks: Vec<Task>,
    /// The limit this check was made against — so messages can quote it.
    pub limit: usize,
}

/// The configured limit, clamped. A missing or unparsable setting means the
/// default: the limit is a promise the app keeps, never something that silently
/// disappears because a value got corrupted.
pub fn wip_limit(conn: &Connection) -> usize {
    conn.query_row(
        "SELECT value FROM settings WHERE key = 'wip_limit'",
        [],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .and_then(|value| value.trim().parse::<usize>().ok())
    .map(clamp_wip_limit)
    .unwrap_or(DEFAULT_WIP_LIMIT)
}

/// Bring any proposed limit inside the guard rails.
pub fn clamp_wip_limit(limit: usize) -> usize {
    limit.clamp(MIN_WIP_LIMIT, MAX_WIP_LIMIT)
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

    let limit = wip_limit(conn);

    WipCheckResult {
        allowed: count < limit,
        doing_tasks: tasks,
        limit,
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

    /// Put `n` tasks into `doing` in a fresh database.
    fn with_doing_tasks(n: usize) -> Connection {
        let conn = init_test_db();
        conn.execute("INSERT INTO projects (id, name) VALUES ('p1', 'Test')", [])
            .unwrap();
        for i in 0..n {
            conn.execute(
                "INSERT INTO tasks (id, title, project_id, status) VALUES (?1, ?2, 'p1', 'doing')",
                rusqlite::params![format!("t{}", i), format!("Task {}", i)],
            )
            .unwrap();
        }
        conn
    }

    fn set_limit(conn: &Connection, value: &str) {
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('wip_limit', ?1)",
            [value],
        )
        .unwrap();
    }

    #[test]
    fn unset_limit_is_the_default() {
        let conn = init_test_db();
        assert_eq!(wip_limit(&conn), DEFAULT_WIP_LIMIT);
    }

    #[test]
    fn a_configured_limit_is_honoured() {
        let conn = with_doing_tasks(2);
        set_limit(&conn, "5");
        assert_eq!(wip_limit(&conn), 5);
        assert!(check_wip(&conn, None).allowed);

        set_limit(&conn, "2");
        let result = check_wip(&conn, None);
        assert!(!result.allowed);
        assert_eq!(result.limit, 2);
    }

    #[test]
    fn nonsense_settings_never_break_the_limit() {
        let conn = init_test_db();
        for (stored, expected) in [
            ("0", MIN_WIP_LIMIT),
            ("999", MAX_WIP_LIMIT),
            ("-1", DEFAULT_WIP_LIMIT),
            ("три", DEFAULT_WIP_LIMIT),
            ("", DEFAULT_WIP_LIMIT),
        ] {
            set_limit(&conn, stored);
            assert_eq!(wip_limit(&conn), expected, "stored value {:?}", stored);
        }
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
