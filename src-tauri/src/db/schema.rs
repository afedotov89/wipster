pub const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'inbox' CHECK (status IN ('inbox', 'queue', 'doing', 'done')),
    priority TEXT CHECK (priority IN ('p0', 'p1', 'p2', 'p3')),
    due TEXT,
    estimate TEXT CHECK (estimate IN ('s', 'm', 'l')),
    tags TEXT NOT NULL DEFAULT '[]',
    dod TEXT,
    checklist TEXT NOT NULL DEFAULT '[]',
    next_step TEXT,
    return_ref TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);

CREATE TABLE IF NOT EXISTS dependencies (
    from_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    to_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    dep_type TEXT NOT NULL CHECK (dep_type IN ('blocks', 'blocked_by')),
    PRIMARY KEY (from_task_id, to_task_id)
);

CREATE TABLE IF NOT EXISTS context_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    captured_at TEXT NOT NULL DEFAULT (datetime('now')),
    app TEXT,
    window_title TEXT,
    url TEXT,
    repo TEXT,
    branch TEXT,
    file_path TEXT,
    note TEXT
);

CREATE TABLE IF NOT EXISTS changelog (
    id TEXT PRIMARY KEY NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    actor TEXT NOT NULL DEFAULT 'user' CHECK (actor IN ('user', 'agent')),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    undone INTEGER NOT NULL DEFAULT 0,
    batch_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_changelog_time ON changelog(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_changelog_batch ON changelog(batch_id);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"#;
