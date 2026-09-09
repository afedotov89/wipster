use rusqlite::Connection;

use super::schema;

/// Version the schema reaches once every migration below has run. Tests assert
/// against this instead of a literal, so adding a migration means touching one
/// number rather than hunting for the assertions that pinned the old one.
pub const LATEST_VERSION: i32 = 15;

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

    if version < 9 {
        conn.execute_batch("ALTER TABLE tasks ADD COLUMN tracker_url TEXT;")?;
        conn.execute("INSERT OR REPLACE INTO schema_version (version) VALUES (?1)", [9])?;
    }

    if version < 10 {
        conn.execute_batch("ALTER TABLE tasks ADD COLUMN energy TEXT CHECK (energy IN ('low', 'medium', 'high'));")?;
        conn.execute("INSERT OR REPLACE INTO schema_version (version) VALUES (?1)", [10])?;
    }

    if version < 11 {
        conn.execute_batch("ALTER TABLE tasks ADD COLUMN completed_at TEXT;")?;
        // Backfill: for existing done tasks, use updated_at as completed_at
        conn.execute_batch("UPDATE tasks SET completed_at = updated_at WHERE status = 'done' AND completed_at IS NULL;")?;
        conn.execute("INSERT OR REPLACE INTO schema_version (version) VALUES (?1)", [11])?;
    }

    if version < 12 {
        conn.execute_batch(
            "ALTER TABLE chat_messages ADD COLUMN pending_confirmations_json TEXT;
             ALTER TABLE chat_messages ADD COLUMN confirmation_status TEXT;"
        )?;
        conn.execute("INSERT OR REPLACE INTO schema_version (version) VALUES (?1)", [12])?;
    }

    if version < 13 {
        conn.execute_batch("ALTER TABLE tasks ADD COLUMN archived_at TEXT;")?;
        conn.execute("INSERT OR REPLACE INTO schema_version (version) VALUES (?1)", [13])?;
    }

    if version < 14 {
        // Sub-projects. Nullable, so every existing project stays a root and
        // nothing about today's behaviour changes until a parent is chosen.
        conn.execute_batch(
            "ALTER TABLE projects ADD COLUMN parent_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
             CREATE INDEX IF NOT EXISTS idx_projects_parent ON projects(parent_id);",
        )?;
        conn.execute("INSERT OR REPLACE INTO schema_version (version) VALUES (?1)", [14])?;
    }

    if version < 15 {
        // Custom project icons: the image itself (a data URL) and whether it is
        // a single-colour glyph that should take the project's colour.
        conn.execute_batch(
            "ALTER TABLE projects ADD COLUMN icon_image TEXT;
             ALTER TABLE projects ADD COLUMN icon_mono INTEGER NOT NULL DEFAULT 0;",
        )?;
        conn.execute(
            "INSERT OR REPLACE INTO schema_version (version) VALUES (?1)",
            [LATEST_VERSION],
        )?;
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
        assert_eq!(current_version(&conn), LATEST_VERSION);
    }

    #[test]
    fn test_migration_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        run(&conn).unwrap();
        run(&conn).unwrap();
        assert_eq!(current_version(&conn), LATEST_VERSION);
    }

    /// An existing project keeps working as a root: the new column is there and
    /// it is null for everything that was already in the database.
    #[test]
    fn sub_projects_start_out_flat() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        run(&conn).unwrap();
        conn.execute("INSERT INTO projects (id, name) VALUES ('p1', 'Flexar')", [])
            .unwrap();
        let parent: Option<String> = conn
            .query_row("SELECT parent_id FROM projects WHERE id = 'p1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(parent, None);
    }
}
