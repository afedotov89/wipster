use rusqlite::Connection;

use super::schema;

pub fn run(conn: &Connection) -> Result<(), Box<dyn std::error::Error>> {
    let version = current_version(conn);

    if version < 1 {
        conn.execute_batch(schema::SCHEMA_V1)?;
        conn.execute(
            "INSERT OR REPLACE INTO schema_version (version) VALUES (?1)",
            [1],
        )?;
    }

    if version < 2 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL
            );"
        )?;
        conn.execute(
            "INSERT OR REPLACE INTO schema_version (version) VALUES (?1)",
            [2],
        )?;
    }

    if version < 3 {
        conn.execute_batch(
            "ALTER TABLE projects ADD COLUMN icon TEXT;
             ALTER TABLE projects ADD COLUMN color TEXT;"
        )?;
        conn.execute(
            "INSERT OR REPLACE INTO schema_version (version) VALUES (?1)",
            [3],
        )?;
    }

    if version < 4 {
        conn.execute_batch(
            "ALTER TABLE tasks ADD COLUMN time_estimate TEXT;"
        )?;
        conn.execute(
            "INSERT OR REPLACE INTO schema_version (version) VALUES (?1)",
            [4],
        )?;
    }

    if version < 5 {
        conn.execute_batch(
            "ALTER TABLE tasks ADD COLUMN promised_to TEXT;"
        )?;
        conn.execute(
            "INSERT OR REPLACE INTO schema_version (version) VALUES (?1)",
            [5],
        )?;
    }

    if version < 6 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS chat_sessions (
                id TEXT PRIMARY KEY NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY NOT NULL,
                session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                text TEXT NOT NULL,
                actions_json TEXT,
                executed INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);"
        )?;
        conn.execute(
            "INSERT OR REPLACE INTO schema_version (version) VALUES (?1)",
            [6],
        )?;
    }

    if version < 7 {
        conn.execute_batch("ALTER TABLE tasks ADD COLUMN comment TEXT;")?;
        conn.execute("INSERT OR REPLACE INTO schema_version (version) VALUES (?1)", [7])?;
    }

    if version < 8 {
        conn.execute_batch("ALTER TABLE tasks ADD COLUMN position INTEGER;")?;
        // Initialize positions from current order
        conn.execute_batch(
            "UPDATE tasks SET position = (
                SELECT COUNT(*) FROM tasks t2
                WHERE t2.project_id = tasks.project_id
                AND t2.status = tasks.status
                AND t2.created_at <= tasks.created_at
                AND t2.id != tasks.id
            )"
        )?;
        conn.execute("INSERT OR REPLACE INTO schema_version (version) VALUES (?1)", [8])?;
    }

    Ok(())
}

fn current_version(conn: &Connection) -> i32 {
    conn.query_row(
        "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
        [],
        |row| row.get(0),
    )
    .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_migration_runs_without_error() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        run(&conn).unwrap();
        assert_eq!(current_version(&conn), 6);
    }

    #[test]
    fn test_migration_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        run(&conn).unwrap();
        run(&conn).unwrap();
        assert_eq!(current_version(&conn), 6);
    }
}
