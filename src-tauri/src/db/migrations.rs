use rusqlite::Connection;

use super::schema;

/// Version the schema reaches once every migration below has run. Tests assert
/// against this instead of a literal, so adding a migration means touching one
/// number rather than hunting for the assertions that pinned the old one.
pub const LATEST_VERSION: i32 = 17;

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
        conn.execute("INSERT OR REPLACE INTO schema_version (version) VALUES (?1)", [15])?;
    }

    if version < 16 {
        // The set of fields a task has becomes the user's to decide.
        //
        // Built-in fields are seeded here in exactly the order and the state
        // they are in today, so nothing changes until someone changes it, and
        // their values stay in the `tasks` columns where they already live.
        // Turning a field off only hides it; removing a custom one only marks
        // it removed. Nothing here ever deletes what was typed.
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS task_fields (
                id TEXT PRIMARY KEY NOT NULL,
                key TEXT NOT NULL UNIQUE,
                label TEXT,
                kind TEXT NOT NULL,
                options TEXT NOT NULL DEFAULT '[]',
                builtin INTEGER NOT NULL DEFAULT 0,
                enabled INTEGER NOT NULL DEFAULT 1,
                position INTEGER NOT NULL DEFAULT 0,
                removed_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS task_field_values (
                task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                field_id TEXT NOT NULL REFERENCES task_fields(id) ON DELETE CASCADE,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (task_id, field_id)
            );

            CREATE INDEX IF NOT EXISTS idx_field_values_task ON task_field_values(task_id);

            INSERT OR IGNORE INTO task_fields (id, key, kind, builtin, position) VALUES
                ('builtin-project',       'project_id',    'select',    1, 0),
                ('builtin-priority',      'priority',      'select',    1, 1),
                ('builtin-energy',        'energy',        'select',    1, 2),
                ('builtin-time-estimate', 'time_estimate', 'text',      1, 3),
                ('builtin-due',           'due',           'date',      1, 4),
                ('builtin-promised-to',   'promised_to',   'text',      1, 5),
                ('builtin-dod',           'dod',           'long_text', 1, 6),
                ('builtin-checklist',     'checklist',     'checklist', 1, 7),
                ('builtin-tracker-url',   'tracker_url',   'url',       1, 8),
                ('builtin-comment',       'comment',       'long_text', 1, 9);",
        )?;
        conn.execute("INSERT OR REPLACE INTO schema_version (version) VALUES (?1)", [16])?;
    }

    if version < 17 {
        // Which column a field sits in when a task fills the window. NULL means
        // "decide from the type", which is what every field starts as — so the
        // layout is unchanged until someone moves something.
        conn.execute_batch("ALTER TABLE task_fields ADD COLUMN column_side TEXT;")?;
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

    /// The field list starts out as the app has always looked: every built-in
    /// field present, enabled, in the order the panel draws them.
    #[test]
    fn built_in_fields_are_seeded_in_todays_order() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        run(&conn).unwrap();

        let mut stmt = conn
            .prepare("SELECT key, enabled, builtin FROM task_fields ORDER BY position")
            .unwrap();
        let fields: Vec<(String, i32, i32)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect();

        let keys: Vec<&str> = fields.iter().map(|(k, _, _)| k.as_str()).collect();
        assert_eq!(
            keys,
            vec![
                "project_id", "priority", "energy", "time_estimate", "due",
                "promised_to", "dod", "checklist", "tracker_url", "comment",
            ],
        );
        assert!(fields.iter().all(|(_, enabled, builtin)| *enabled == 1 && *builtin == 1));
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
