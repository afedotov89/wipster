use reqwest::Client;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::Notify;

// ---- Public types ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallLog {
    pub tool_name: String,
    pub arguments: Value,
    pub result: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingToolCall {
    pub tool_name: String,
    pub arguments: Value,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentResponse {
    pub text: String,
    pub tool_calls: Vec<ToolCallLog>,
    pub pending_confirmations: Vec<PendingToolCall>,
    /// Opaque state to resume the loop after confirmation
    pub continuation: Option<String>,
}

// ---- Live progress ----

/// One step of a run, pushed to the UI while the agent is still working.
///
/// Only the raw facts travel: the tool that is running and a short hint pulled
/// from its arguments. Wording and localisation belong to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct AgentProgress {
    pub run_id: String,
    /// Monotonic per run, so the UI can order and de-duplicate events.
    pub seq: usize,
    /// `thinking` — waiting on the model; `tool` — a tool is executing.
    pub phase: String,
    pub tool: Option<String>,
    /// Set when one tool name covers two user-visible actions (archive/restore).
    pub variant: Option<String>,
    /// Task title, issue key, search query — whatever names the step.
    pub detail: Option<String>,
}

type ProgressSink = dyn Fn(AgentProgress) + Send + Sync;

/// Sink for [`AgentProgress`] events, tagged with the run they belong to.
pub struct ProgressReporter {
    run_id: String,
    sink: Box<ProgressSink>,
    seq: AtomicUsize,
}

impl ProgressReporter {
    pub fn new(
        run_id: impl Into<String>,
        sink: impl Fn(AgentProgress) + Send + Sync + 'static,
    ) -> Self {
        Self { run_id: run_id.into(), sink: Box::new(sink), seq: AtomicUsize::new(0) }
    }

    fn emit(&self, phase: &str, tool: Option<&str>, variant: Option<&str>, detail: Option<String>) {
        (self.sink)(AgentProgress {
            run_id: self.run_id.clone(),
            seq: self.seq.fetch_add(1, Ordering::Relaxed),
            phase: phase.to_string(),
            tool: tool.map(str::to_string),
            variant: variant.map(str::to_string),
            detail,
        });
    }

    /// The model is composing its next move.
    pub fn thinking(&self) {
        self.emit("thinking", None, None, None);
    }

    /// A tool is about to run; `db` is only read to name it.
    pub fn tool(&self, name: &str, args: &Value, db: &Mutex<Connection>) {
        let (variant, detail) = progress_hint(name, args, db);
        self.emit("tool", Some(name), variant, detail);
    }
}

/// Longest hint shown on a progress line — more is noise in a 420px panel.
const HINT_MAX_BYTES: usize = 80;

/// Name a step from its arguments: the task's title, the issue key, the query.
fn progress_hint(
    name: &str,
    args: &Value,
    db: &Mutex<Connection>,
) -> (Option<&'static str>, Option<String>) {
    let arg = |key: &str| {
        args[key]
            .as_str()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_string)
    };
    let task_title = || {
        let id = args["task_id"].as_str()?;
        let conn = db.lock().ok()?;
        conn.query_row("SELECT title FROM tasks WHERE id = ?1", [id], |r| {
            r.get::<_, String>(0)
        })
        .ok()
    };

    let (variant, detail) = match name {
        "create_task" => (None, arg("title")),
        "update_task" | "move_task" | "delete_task" | "get_task" => (None, task_title()),
        "set_task_archived" => (
            if args["archived"].as_bool() == Some(false) { Some("restore") } else { None },
            task_title(),
        ),
        "search_tasks" => (None, arg("query")),
        "read_tracker_issue" => (
            None,
            arg("issue_key")
                .map(|k| crate::services::tracker::extract_issue_key(&k).unwrap_or(k)),
        ),
        "create_tracker_issue" => (None, arg("summary")),
        "remember" => (None, arg("fact")),
        _ => (None, None),
    };

    let detail = detail.map(|d| {
        let cut = crate::services::logger::snippet(&d, HINT_MAX_BYTES);
        if cut.len() < d.len() {
            format!("{}\u{2026}", cut.trim_end())
        } else {
            d
        }
    });
    (variant, detail)
}

// ---- Cancellation ----

/// Error text returned when the user stops a run; the UI matches on it and
/// stays quiet instead of reporting a failure.
pub const CANCELLED: &str = "AGENT_CANCELLED";

static ACTIVE_RUNS: OnceLock<Mutex<HashMap<String, Arc<Notify>>>> = OnceLock::new();

fn active_runs() -> &'static Mutex<HashMap<String, Arc<Notify>>> {
    ACTIVE_RUNS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Register a stoppable run. Await the returned signal alongside the work — it
/// fires when [`cancel_run`] is called with the same id.
pub fn register_run(run_id: &str) -> Arc<Notify> {
    let signal = Arc::new(Notify::new());
    if let Ok(mut runs) = active_runs().lock() {
        runs.insert(run_id.to_string(), signal.clone());
    }
    signal
}

/// Drop a finished run from the registry.
pub fn finish_run(run_id: &str) {
    if let Ok(mut runs) = active_runs().lock() {
        runs.remove(run_id);
    }
}

/// Stop a run. Returns whether it was still live.
pub fn cancel_run(run_id: &str) -> bool {
    let signal = active_runs().lock().ok().and_then(|mut runs| runs.remove(run_id));
    match signal {
        // `notify_one` leaves a permit behind, so a stop racing ahead of the
        // first await still lands.
        Some(signal) => {
            signal.notify_one();
            true
        }
        None => false,
    }
}

/// Execute a confirmed dangerous tool (called after user approves)
pub async fn execute_confirmed_tool(tool_name: &str, args: &Value, db: &Mutex<Connection>) -> String {
    execute_tool_async(tool_name, args, db).await
}

fn is_dangerous(tool_name: &str) -> bool {
    matches!(tool_name, "delete_task" | "create_tracker_issue")
}

// ---- Tool definitions ----

fn tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "create_task",
            "description": "Create a new task",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": { "type": "string", "description": "Task title" },
                    "project_id": { "type": "string", "description": "Project ID" },
                    "priority": { "type": "string", "enum": ["p0","p1","p2","p3"] },
                    "due": { "type": "string", "description": "Due date YYYY-MM-DD" },
                    "time_estimate": { "type": "string", "description": "e.g. 1ч, 2д" },
                    "dod": { "type": "string", "description": "Definition of done" },
                    "promised_to": { "type": "string" },
                    "tracker_url": { "type": "string", "description": "Link to tracker issue" },
                },
                "required": ["title"]
            }
        }),
        json!({
            "name": "update_task",
            "description": "Update fields of an existing task",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": { "type": "string" },
                    "title": { "type": "string" },
                    "project_id": { "type": "string", "description": "Move the task to this project (id from list_projects)" },
                    "priority": { "type": "string", "enum": ["p0","p1","p2","p3"] },
                    "due": { "type": "string" },
                    "time_estimate": { "type": "string" },
                    "dod": { "type": "string" },
                    "next_step": { "type": "string" },
                    "promised_to": { "type": "string" },
                    "comment": { "type": "string" },
                    "tracker_url": { "type": "string" },
                },
                "required": ["task_id"]
            }
        }),
        json!({
            "name": "move_task",
            "description": "Change task status (inbox/queue/doing/done)",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": { "type": "string" },
                    "new_status": { "type": "string", "enum": ["inbox","queue","doing","done"] },
                },
                "required": ["task_id", "new_status"]
            }
        }),
        json!({
            "name": "delete_task",
            "description": "Delete a task permanently",
            "parameters": {
                "type": "object",
                "properties": { "task_id": { "type": "string" } },
                "required": ["task_id"]
            }
        }),
        json!({
            "name": "set_task_archived",
            "description": "Archive a task (hides it from the board without deleting it) or restore it from the archive. Use for stale tasks nobody intends to do.",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": { "type": "string" },
                    "archived": { "type": "boolean", "description": "true = move to archive, false = restore to the board" },
                },
                "required": ["task_id", "archived"]
            }
        }),
        json!({
            "name": "search_tasks",
            "description": "Search tasks by text, project, or status. The text is matched against the title, definition of done, comment, next step and tracker link",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Text to search in title" },
                    "project_id": { "type": "string" },
                    "status": { "type": "string", "enum": ["inbox","queue","doing","done"] },
                },
            }
        }),
        json!({
            "name": "list_tasks",
            "description": "List tasks, optionally filtered by project and/or status. Use when user asks 'what tasks do I have', 'show my tasks', 'what's in progress', etc.",
            "parameters": {
                "type": "object",
                "properties": {
                    "project_id": { "type": "string", "description": "Filter by project" },
                    "status": { "type": "string", "enum": ["inbox","queue","doing","done"], "description": "Filter by status" },
                },
            }
        }),
        json!({
            "name": "list_projects",
            "description": "List all projects with their IDs and names",
            "parameters": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "get_task",
            "description": "Get full details of a task by ID",
            "parameters": {
                "type": "object",
                "properties": { "task_id": { "type": "string" } },
                "required": ["task_id"]
            }
        }),
        json!({
            "name": "read_tracker_issue",
            "description": "Read a Yandex Tracker issue by key (e.g. QUEUE-123) or URL",
            "parameters": {
                "type": "object",
                "properties": { "issue_key": { "type": "string", "description": "Issue key like QUEUE-123 or full tracker URL" } },
                "required": ["issue_key"]
            }
        }),
        json!({
            "name": "create_tracker_issue",
            "description": "Create a new issue in Yandex Tracker",
            "parameters": {
                "type": "object",
                "properties": {
                    "queue": { "type": "string", "description": "Queue key, e.g. MYPROJECT" },
                    "summary": { "type": "string", "description": "Issue title" },
                    "description": { "type": "string", "description": "Issue description" },
                    "priority": { "type": "string", "enum": ["p0","p1","p2","p3"], "description": "Priority mapping: p0=critical, p1=high, p2=normal, p3=low" },
                },
                "required": ["queue", "summary"]
            }
        }),
        json!({
            "name": "remember",
            "description": "Save a fact about the user to persistent memory",
            "parameters": {
                "type": "object",
                "properties": { "fact": { "type": "string" } },
                "required": ["fact"]
            }
        }),
    ]
}

// ---- Tool execution ----

fn record(conn: &Connection, action: &str, entity_type: &str, entity_id: &str, old: Option<&str>, new: Option<&str>) {
    let _ = crate::services::undo_redo::record_change(conn, action, entity_type, entity_id, old, new, None);
}

/// Full-fidelity snapshot so undo/redo can restore every column, not just the
/// ones the agent happened to touch.
fn task_snapshot(conn: &Connection, id: &str) -> Option<String> {
    use crate::models::task::{task_from_row, TASK_COLUMNS};
    conn.query_row(
        &format!("SELECT {} FROM tasks WHERE id = ?1", TASK_COLUMNS),
        [id],
        task_from_row,
    )
    .ok()
    .and_then(|task| serde_json::to_string(&task).ok())
}

fn execute_tool_sync(conn: &Connection, tool_name: &str, args: &Value) -> Result<String, String> {
    match tool_name {
        "create_task" => {
            let title = args["title"].as_str().ok_or("missing title")?;
            let id = uuid::Uuid::new_v4().to_string();
            let project_id = args["project_id"].as_str();
            let status = args["status"].as_str().unwrap_or("queue");
            let priority = args["priority"].as_str();
            let due = args["due"].as_str();
            let time_estimate = args["time_estimate"].as_str();
            let dod = args["dod"].as_str();
            let promised_to = args["promised_to"].as_str();
            let tracker_url = args["tracker_url"].as_str();

            // New tasks land on top of their column, same as the quick-add input.
            let position: i32 = conn.query_row(
                "SELECT COALESCE(MIN(position), 0) - 1 FROM tasks \
                 WHERE project_id IS ?1 AND status = ?2 AND archived_at IS NULL",
                rusqlite::params![project_id, status],
                |row| row.get(0),
            ).unwrap_or(-1);

            conn.execute(
                "INSERT INTO tasks (id, title, project_id, status, priority, due, time_estimate, dod, promised_to, tracker_url, position) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                rusqlite::params![id, title, project_id, status, priority, due, time_estimate, dod, promised_to, tracker_url, position],
            ).map_err(|e| e.to_string())?;

            let snap = task_snapshot(conn, &id);
            record(conn, "create", "task", &id, None, snap.as_deref());

            Ok(format!("Created task '{}' (id: {})", title, id))
        }
        "update_task" => {
            let task_id = args["task_id"].as_str().ok_or("missing task_id")?;
            let old_snap = task_snapshot(conn, task_id);

            let mut updates = Vec::new();
            let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

            for field in ["title", "priority", "due", "time_estimate", "dod", "next_step", "promised_to", "comment", "tracker_url"] {
                if let Some(val) = args[field].as_str() {
                    updates.push(format!("{} = ?", field));
                    params.push(Box::new(val.to_string()));
                }
            }

            // Moving between projects is a separate case: an id that does not
            // exist would either break the foreign key or quietly detach the
            // task from every board, so it is checked before it is written.
            if let Some(project_id) = args["project_id"].as_str() {
                let exists = conn
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1)",
                        [project_id],
                        |row| row.get::<_, i32>(0),
                    )
                    .unwrap_or(0)
                    == 1;
                if !exists {
                    return Err(format!(
                        "No project with id {}. Call list_projects to get the real ids.",
                        project_id
                    ));
                }
                updates.push("project_id = ?".to_string());
                params.push(Box::new(project_id.to_string()));
            }

            if updates.is_empty() {
                return Ok("No fields to update".to_string());
            }

            updates.push("updated_at = datetime('now')".to_string());
            params.push(Box::new(task_id.to_string()));

            let sql = format!("UPDATE tasks SET {} WHERE id = ?", updates.join(", "));
            let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
            conn.execute(&sql, param_refs.as_slice()).map_err(|e| e.to_string())?;

            let new_snap = task_snapshot(conn, task_id);
            record(conn, "update", "task", task_id, old_snap.as_deref(), new_snap.as_deref());

            Ok(format!("Updated task {}", task_id))
        }
        "move_task" => {
            let task_id = args["task_id"].as_str().ok_or("missing task_id")?;
            let new_status = args["new_status"].as_str().ok_or("missing new_status")?;
            let old_snap = task_snapshot(conn, task_id);

            if new_status == "doing" {
                // One WIP rule for the whole app — the guard also knows the
                // configured limit and that archived tasks do not count.
                let wip = crate::services::wip_guard::check_wip(conn, Some(task_id));
                if !wip.allowed {
                    return Err(format!(
                        "WIP limit reached ({} tasks in doing). Move another task out first.",
                        wip.limit,
                    ));
                }
            }

            conn.execute(
                "UPDATE tasks SET status = ?1, updated_at = datetime('now') WHERE id = ?2",
                rusqlite::params![new_status, task_id],
            ).map_err(|e| e.to_string())?;

            let new_snap = task_snapshot(conn, task_id);
            record(conn, "update", "task", task_id, old_snap.as_deref(), new_snap.as_deref());

            Ok(format!("Moved task {} to {}", task_id, new_status))
        }
        "delete_task" => {
            let task_id = args["task_id"].as_str().ok_or("missing task_id")?;
            let old_snap = task_snapshot(conn, task_id);
            conn.execute("DELETE FROM tasks WHERE id = ?1", [task_id]).map_err(|e| e.to_string())?;
            record(conn, "delete", "task", task_id, old_snap.as_deref(), None);
            Ok(format!("Deleted task {}", task_id))
        }
        "set_task_archived" => {
            let task_id = args["task_id"].as_str().ok_or("missing task_id")?;
            let archived = args["archived"].as_bool().ok_or("missing archived")?;
            let old_snap = task_snapshot(conn, task_id);

            if archived {
                conn.execute(
                    "UPDATE tasks SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?1",
                    [task_id],
                ).map_err(|e| e.to_string())?;
            } else {
                // A task archived mid-flight only returns to 'doing' if WIP allows
                // it — same guard, same configured limit as everywhere else.
                let wip_allows = crate::services::wip_guard::check_wip(conn, Some(task_id)).allowed;
                conn.execute(
                    "UPDATE tasks SET archived_at = NULL, updated_at = datetime('now'), \
                     status = CASE WHEN status = 'doing' AND NOT ?2 THEN 'queue' ELSE status END \
                     WHERE id = ?1",
                    rusqlite::params![task_id, wip_allows],
                ).map_err(|e| e.to_string())?;
            }

            let new_snap = task_snapshot(conn, task_id);
            record(conn, "update", "task", task_id, old_snap.as_deref(), new_snap.as_deref());

            Ok(format!(
                "{} task {}",
                if archived { "Archived" } else { "Restored" },
                task_id
            ))
        }
        "search_tasks" => {
            let query = args["query"].as_str().unwrap_or("");
            let project_id = args["project_id"].as_str();
            let status = args["status"].as_str();

            let mut sql = "SELECT id, title, status, priority, due, time_estimate FROM tasks WHERE archived_at IS NULL".to_string();
            let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

            if !query.is_empty() {
                // A task "about X" often mentions X in its description or its
                // ticket link rather than its title.
                sql.push_str(
                    " AND (title LIKE ? OR COALESCE(dod, '') LIKE ? OR COALESCE(comment, '') LIKE ? \
                     OR COALESCE(next_step, '') LIKE ? OR COALESCE(tracker_url, '') LIKE ?)",
                );
                let pattern = format!("%{}%", query);
                for _ in 0..5 {
                    params.push(Box::new(pattern.clone()));
                }
            }
            if let Some(pid) = project_id {
                // A project stands for its sub-projects too, exactly as on the board.
                let (filter, ids) =
                    crate::services::project_tree::subtree_filter(conn, pid, "project_id");
                sql.push_str(&format!(" AND {}", filter));
                for id in ids {
                    params.push(Box::new(id));
                }
            }
            if let Some(s) = status {
                sql.push_str(" AND status = ?");
                params.push(Box::new(s.to_string()));
            }
            sql.push_str(" ORDER BY created_at DESC LIMIT 20");

            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

            let tasks: Vec<String> = stmt.query_map(param_refs.as_slice(), |row| {
                Ok(format!("- {} [{}] {} priority={} due={} est={}",
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                ))
            }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();

            if tasks.is_empty() {
                Ok("No tasks found".to_string())
            } else {
                Ok(tasks.join("\n"))
            }
        }
        "list_tasks" => {
            let project_id = args["project_id"].as_str();
            let status = args["status"].as_str();

            let mut sql = "SELECT t.id, t.title, t.status, t.priority, t.due, t.time_estimate, \
                           COALESCE(p.name, '') FROM tasks t \
                           LEFT JOIN projects p ON t.project_id = p.id WHERE t.archived_at IS NULL".to_string();
            let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

            if let Some(pid) = project_id {
                let (filter, ids) =
                    crate::services::project_tree::subtree_filter(conn, pid, "t.project_id");
                sql.push_str(&format!(" AND {}", filter));
                for id in ids {
                    params.push(Box::new(id));
                }
            }
            if let Some(s) = status {
                sql.push_str(" AND t.status = ?");
                params.push(Box::new(s.to_string()));
            }
            sql.push_str(" ORDER BY t.status, t.position ASC");

            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

            let rows: Vec<String> = stmt.query_map(param_refs.as_slice(), |row| {
                Ok(format!("- {} | {} [{}] proj={} prio={} due={} est={}",
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                ))
            }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();

            if rows.is_empty() {
                Ok("No tasks".to_string())
            } else {
                Ok(format!("{} task(s):\n{}", rows.len(), rows.join("\n")))
            }
        }
        "list_projects" => {
            // The parent's name comes along: without it a sub-project reads as
            // an unrelated project and the model picks the wrong one.
            let mut stmt = conn.prepare(
                "SELECT p.id, p.name, parent.name FROM projects p \
                 LEFT JOIN projects parent ON p.parent_id = parent.id \
                 ORDER BY p.\"order\" ASC"
            ).map_err(|e| e.to_string())?;
            let rows: Vec<String> = stmt.query_map([], |row| {
                let parent: Option<String> = row.get(2)?;
                Ok(format!(
                    "- {} | {}{}",
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    parent.map(|p| format!(" (sub-project of {})", p)).unwrap_or_default(),
                ))
            }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
            if rows.is_empty() {
                Ok("No projects".to_string())
            } else {
                Ok(rows.join("\n"))
            }
        }
        "get_task" => {
            let task_id = args["task_id"].as_str().ok_or("missing task_id")?;
            let task_json = conn.query_row(
                "SELECT id, title, project_id, status, priority, due, time_estimate, dod, \
                 next_step, promised_to, comment, checklist FROM tasks WHERE id = ?1",
                [task_id],
                |row| {
                    Ok(json!({
                        "id": row.get::<_, String>(0)?,
                        "title": row.get::<_, String>(1)?,
                        "project_id": row.get::<_, Option<String>>(2)?,
                        "status": row.get::<_, String>(3)?,
                        "priority": row.get::<_, Option<String>>(4)?,
                        "due": row.get::<_, Option<String>>(5)?,
                        "time_estimate": row.get::<_, Option<String>>(6)?,
                        "dod": row.get::<_, Option<String>>(7)?,
                        "next_step": row.get::<_, Option<String>>(8)?,
                        "promised_to": row.get::<_, Option<String>>(9)?,
                        "comment": row.get::<_, Option<String>>(10)?,
                        "checklist": row.get::<_, String>(11)?,
                    }))
                },
            ).map_err(|e| format!("Task not found: {}", e))?;
            Ok(serde_json::to_string_pretty(&task_json).unwrap_or_default())
        }
        "remember" => {
            let fact = args["fact"].as_str().ok_or("missing fact")?;
            let existing: String = conn.query_row(
                "SELECT value FROM settings WHERE key = 'agent_memory'",
                [], |r| r.get(0),
            ).unwrap_or_default();
            let new_memory = if existing.is_empty() {
                fact.to_string()
            } else {
                format!("{}\n{}", existing, fact)
            };
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES ('agent_memory', ?1)",
                [&new_memory],
            ).map_err(|e| e.to_string())?;
            Ok(format!("Remembered: {}", fact))
        }
        _ => Err(format!("Unknown tool: {}", tool_name)),
    }
}

async fn execute_tool_async(tool_name: &str, args: &Value, db: &Mutex<Connection>) -> String {
    // Handle async tools (tracker) separately
    if tool_name == "create_tracker_issue" {
        let queue = args["queue"].as_str().unwrap_or("");
        let summary = args["summary"].as_str().unwrap_or("");
        let description = args["description"].as_str();
        let priority = args["priority"].as_str();

        let (token, org_id) = {
            let conn = db.lock().unwrap();
            let token = conn.query_row("SELECT value FROM settings WHERE key = 'tracker_token'", [], |r| r.get::<_, String>(0)).ok();
            let org_id = conn.query_row("SELECT value FROM settings WHERE key = 'tracker_org_id'", [], |r| r.get::<_, String>(0)).ok();
            (token, org_id)
        };

        return match (token, org_id) {
            (Some(t), Some(o)) => {
                match crate::services::tracker::create_issue(&t, &o, queue, summary, description, priority).await {
                    Ok(issue) => format!("Created tracker issue: {} — {}\nhttps://tracker.yandex.ru/{}", issue.key, issue.summary, issue.key),
                    Err(e) => format!("Error creating tracker issue: {}", e),
                }
            }
            _ => "Tracker not configured. Go to Settings → Integrations.".to_string(),
        };
    }

    if tool_name == "read_tracker_issue" {
        let issue_key_raw = args["issue_key"].as_str().unwrap_or("");
        let key = crate::services::tracker::extract_issue_key(issue_key_raw)
            .unwrap_or_else(|| issue_key_raw.to_string());

        let (token, org_id) = {
            let conn = db.lock().unwrap();
            let token = conn.query_row("SELECT value FROM settings WHERE key = 'tracker_token'", [], |r| r.get::<_, String>(0)).ok();
            let org_id = conn.query_row("SELECT value FROM settings WHERE key = 'tracker_org_id'", [], |r| r.get::<_, String>(0)).ok();
            (token, org_id)
        };

        match (token, org_id) {
            (Some(t), Some(o)) => {
                match crate::services::tracker::fetch_issue(&t, &o, &key).await {
                    Ok(issue) => issue.to_context_string(),
                    Err(e) => format!("Error reading tracker issue: {}", e),
                }
            }
            _ => "Tracker not configured. Go to Settings → Integrations.".to_string(),
        }
    } else {
        // Sync tools — lock DB
        let conn = db.lock().unwrap();
        execute_tool_sync(&conn, tool_name, args).unwrap_or_else(|e| format!("Error: {}", e))
    }
}

// ---- System prompt ----

fn build_system_prompt(memory: &str) -> String {
    let memory_section = if memory.is_empty() {
        String::new()
    } else {
        format!("\nYour memory:\n{}\n", memory)
    };

    format!(
        r#"You are Wipster's task management assistant. You have tools to manage tasks, read tracker issues, and remember facts.

Use tools to fulfill user requests. Call multiple tools if needed. After completing actions, summarize what you did.
{memory}
Rules:
- Use the same language as the user
- Use list_projects to see available projects; use list_tasks to see tasks (filter by project_id/status as needed)
- Use search_tasks to find a specific task by name
- When user mentions a tracker link, use read_tracker_issue to get details
- When creating tasks, fill in as many fields as you can infer
- Stale tasks nobody plans to do belong in the archive (set_task_archived), not the trash — archived tasks are hidden from list_tasks/search_tasks but can be restored
- Use remember to save personal info the user shares"#,
        memory = memory_section,
    )
}

// ---- Provider-specific API calls ----

#[derive(Debug, Deserialize)]
struct AnthropicContentBlock {
    #[serde(rename = "type")]
    block_type: String,
    text: Option<String>,
    id: Option<String>,
    name: Option<String>,
    input: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct AnthropicApiResponse {
    content: Vec<AnthropicContentBlock>,
    stop_reason: Option<String>,
}

async fn call_anthropic(
    client: &Client, api_key: &str, model: &str, system: &str,
    messages: &[Value], tools: &[Value],
) -> Result<(Option<String>, Vec<(String, String, Value)>, String), String> {
    let body = json!({
        "model": model,
        "max_tokens": 16000,
        "system": system,
        "messages": messages,
        "tools": tools,
    });

    let resp = client.post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body).send().await.map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("API error {}: {}", status, body));
    }

    let api_resp: AnthropicApiResponse = resp.json().await.map_err(|e| e.to_string())?;

    let mut text = String::new();
    let mut tool_calls = Vec::new();

    for block in &api_resp.content {
        match block.block_type.as_str() {
            "text" => {
                if let Some(t) = &block.text {
                    text.push_str(t);
                }
            }
            "tool_use" => {
                if let (Some(id), Some(name), Some(input)) = (&block.id, &block.name, &block.input) {
                    tool_calls.push((id.clone(), name.clone(), input.clone()));
                }
            }
            _ => {}
        }
    }

    let stop = api_resp.stop_reason.unwrap_or_default();
    Ok((if text.is_empty() { None } else { Some(text) }, tool_calls, stop))
}

async fn call_openai(
    client: &Client, api_key: &str, model: &str, system: &str,
    messages: &[Value], tools: &[Value],
) -> Result<(Option<String>, Vec<(String, String, Value)>, String), String> {
    let mut msgs = vec![json!({"role": "system", "content": system})];
    msgs.extend_from_slice(messages);

    let body = json!({
        "model": model,
        "max_tokens": 16000,
        "messages": msgs,
        "tools": tools,
    });

    let t0 = std::time::Instant::now();
    let resp = client.post("https://openrouter.ai/api/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("content-type", "application/json")
        .json(&body).send().await.map_err(|e| {
            let msg = format!("[agent] OpenRouter request failed after {:.0}s: {} (model={}, msg_count={})",
                t0.elapsed().as_secs_f32(), e, model, msgs.len());
            crate::services::logger::log("error", &msg);
            msg
        })?;

    crate::services::logger::log("info", &format!("[agent] OpenRouter responded status={} in {:.1}s",
        resp.status(), t0.elapsed().as_secs_f32()));

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let msg = format!("[agent] API error {}: {}", status, crate::services::logger::snippet(&body, 300));
        crate::services::logger::log("error", &msg);
        return Err(msg);
    }

    let j: Value = resp.json().await.map_err(|e| e.to_string())?;
    let choice = &j["choices"][0];
    let msg = &choice["message"];

    let text = msg["content"].as_str().map(|s| s.to_string());
    let finish = choice["finish_reason"].as_str().unwrap_or("").to_string();

    let mut tool_calls = Vec::new();
    if let Some(tcs) = msg["tool_calls"].as_array() {
        for tc in tcs {
            let id = tc["id"].as_str().unwrap_or("").to_string();
            let name = tc["function"]["name"].as_str().unwrap_or("").to_string();
            let args_str = tc["function"]["arguments"].as_str().unwrap_or("{}");
            let args: Value = serde_json::from_str(args_str).unwrap_or(json!({}));
            tool_calls.push((id, name, args));
        }
    }

    Ok((text, tool_calls, finish))
}

// ---- Format tools for each provider ----

fn tools_for_anthropic(defs: &[Value]) -> Vec<Value> {
    defs.iter().map(|d| json!({
        "name": d["name"],
        "description": d["description"],
        "input_schema": d["parameters"],
    })).collect()
}

fn tools_for_openai(defs: &[Value]) -> Vec<Value> {
    defs.iter().map(|d| json!({
        "type": "function",
        "function": {
            "name": d["name"],
            "description": d["description"],
            "parameters": d["parameters"],
        }
    })).collect()
}

// ---- The main loop ----

pub async fn chat(
    provider: &str,
    api_key: &str,
    model: &str,
    user_message: &str,
    history: &[(String, String)],
    memory: &str,
    focused_task_context: &str,
    db: &Mutex<Connection>,
    progress: &ProgressReporter,
) -> Result<AgentResponse, String> {
    let base_prompt = build_system_prompt(memory);
    let system = if focused_task_context.is_empty() {
        base_prompt
    } else {
        format!(
            "{focus}\n\n{base}",
            focus = format!(
                "=== CURRENTLY OPEN TASK (user has it open in the UI right now) ===\n\
                 {ctx}\n\
                 When the user says \"this task\", \"эта задача\", \"текущая задача\", \"открытая задача\", \
                 \"задача в приложении\", or refers to the task without naming it — they mean THE TASK ABOVE. \
                 Use its id directly. Do NOT call search_tasks or list_tasks to find it.",
                ctx = focused_task_context
            ),
            base = base_prompt,
        )
    };

    let tool_defs = tool_definitions();
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let is_anthropic = provider != "openrouter";
    let formatted_tools = if is_anthropic { tools_for_anthropic(&tool_defs) } else { tools_for_openai(&tool_defs) };

    // Build conversation messages
    let mut messages: Vec<Value> = Vec::new();
    for (role, content) in history {
        messages.push(json!({"role": role, "content": content}));
    }
    messages.push(json!({"role": "user", "content": user_message}));

    let mut all_tool_calls: Vec<ToolCallLog> = Vec::new();
    // Enough headroom for a bulk request — "move every task about X into project
    // Y" is one search plus a run of updates — without letting a confused model
    // loop forever. The user can stop a run at any point anyway.
    let max_iterations = 16;

    for iteration in 0..max_iterations {
        crate::services::logger::log("info", &format!("[agent] iteration {}, messages: {}", iteration, messages.len()));
        progress.thinking();

        let (text, tool_calls, stop_reason) = if is_anthropic {
            call_anthropic(&client, api_key, model, &system, &messages, &formatted_tools).await?
        } else {
            call_openai(&client, api_key, model, &system, &messages, &formatted_tools).await?
        };

        // No tool calls — return final text
        if tool_calls.is_empty() {
            return Ok(AgentResponse {
                text: text.unwrap_or_default(),
                tool_calls: all_tool_calls, pending_confirmations: vec![], continuation: None,
            });
        }

        // Append assistant message with tool calls
        if is_anthropic {
            let mut content_blocks: Vec<Value> = Vec::new();
            if let Some(t) = &text {
                content_blocks.push(json!({"type": "text", "text": t}));
            }
            for (id, name, input) in &tool_calls {
                content_blocks.push(json!({
                    "type": "tool_use", "id": id, "name": name, "input": input
                }));
            }
            messages.push(json!({"role": "assistant", "content": content_blocks}));
        } else {
            let tc_array: Vec<Value> = tool_calls.iter().map(|(id, name, args)| {
                json!({
                    "id": id, "type": "function",
                    "function": {"name": name, "arguments": serde_json::to_string(args).unwrap_or_default()}
                })
            }).collect();
            messages.push(json!({
                "role": "assistant", "content": text, "tool_calls": tc_array
            }));
        }

        // Split: safe tools execute now, dangerous ones need confirmation
        let mut pending: Vec<PendingToolCall> = Vec::new();
        let mut anthropic_results: Vec<Value> = Vec::new();
        let mut has_dangerous = false;

        for (id, name, args) in &tool_calls {
            if is_dangerous(name) {
                // Don't execute — collect for confirmation
                has_dangerous = true;
                let desc = match name.as_str() {
                    "delete_task" => format!("Delete task {}", args["task_id"].as_str().unwrap_or("?")),
                    "create_tracker_issue" => format!("Create tracker issue: {} in {}",
                        args["summary"].as_str().unwrap_or("?"), args["queue"].as_str().unwrap_or("?")),
                    _ => format!("{}: {}", name, args),
                };
                pending.push(PendingToolCall {
                    tool_name: name.clone(),
                    arguments: args.clone(),
                    description: desc,
                });

                // Feed a "needs confirmation" result back so the LLM knows
                let placeholder = format!("⏳ Awaiting user confirmation for {}", name);
                if is_anthropic {
                    anthropic_results.push(json!({
                        "type": "tool_result", "tool_use_id": id, "content": placeholder
                    }));
                } else {
                    messages.push(json!({
                        "role": "tool", "tool_call_id": id, "content": placeholder
                    }));
                }
            } else {
                // Safe — execute immediately
                progress.tool(name, args, db);
                let result = execute_tool_async(name, args, db).await;

                crate::services::logger::log("info", &format!("[agent] tool {}({}) -> {}", name, args, crate::services::logger::snippet(&result, 200)));

                all_tool_calls.push(ToolCallLog {
                    tool_name: name.clone(),
                    arguments: args.clone(),
                    result: result.clone(),
                });

                if is_anthropic {
                    anthropic_results.push(json!({
                        "type": "tool_result", "tool_use_id": id, "content": result
                    }));
                } else {
                    messages.push(json!({
                        "role": "tool", "tool_call_id": id, "content": result
                    }));
                }
            }
        }

        // If dangerous tools pending — pause and return for confirmation
        if has_dangerous {
            if is_anthropic && !anthropic_results.is_empty() {
                messages.push(json!({"role": "user", "content": anthropic_results}));
            }

            return Ok(AgentResponse {
                text: text.unwrap_or_default(),
                tool_calls: all_tool_calls,
                pending_confirmations: pending,
                continuation: Some(serde_json::to_string(&messages).unwrap_or_default()),
            });
        }

        if is_anthropic && !anthropic_results.is_empty() {
            messages.push(json!({"role": "user", "content": anthropic_results}));
        }

        // Check stop reason
        if stop_reason != "tool_use" && stop_reason != "tool_calls" {
            if let Some(t) = text {
                return Ok(AgentResponse { text: t, tool_calls: all_tool_calls, pending_confirmations: vec![], continuation: None });
            }
        }
    }

    Ok(AgentResponse {
        text: "Reached maximum tool call iterations.".to_string(),
        tool_calls: all_tool_calls, pending_confirmations: vec![], continuation: None,
    })
}

/// Run a self-contained tool-use loop with a restricted, read-only toolset and
/// return the model's final text answer. Used by structured-output features
/// (e.g. AI fill) that need the agent to gather context via tools but must not
/// expose mutating tools. `allowed_tools` is intersected with the safe (non-
/// dangerous) tool set, so it can never execute confirmation-gated actions.
pub async fn run_tool_loop(
    provider: &str,
    api_key: &str,
    model: &str,
    system: &str,
    user_message: &str,
    allowed_tools: &[&str],
    db: &Mutex<Connection>,
) -> Result<String, String> {
    run_tool_loop_traced(provider, api_key, model, system, user_message, allowed_tools, db)
        .await
        .map(|(text, _)| text)
}

/// Same loop as [`run_tool_loop`], but also returns every tool call it made.
/// Used by the connection test, which has to prove tool use actually happened.
pub async fn run_tool_loop_traced(
    provider: &str,
    api_key: &str,
    model: &str,
    system: &str,
    user_message: &str,
    allowed_tools: &[&str],
    db: &Mutex<Connection>,
) -> Result<(String, Vec<ToolCallLog>), String> {
    let tool_defs: Vec<Value> = tool_definitions()
        .into_iter()
        .filter(|d| {
            let name = d["name"].as_str().unwrap_or("");
            allowed_tools.contains(&name) && !is_dangerous(name)
        })
        .collect();

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let is_anthropic = provider != "openrouter";
    let formatted_tools = if is_anthropic { tools_for_anthropic(&tool_defs) } else { tools_for_openai(&tool_defs) };

    let mut messages: Vec<Value> = vec![json!({"role": "user", "content": user_message})];
    let mut trace: Vec<ToolCallLog> = Vec::new();
    let max_iterations = 8;

    for iteration in 0..max_iterations {
        crate::services::logger::log("info", &format!("[agent:loop] iteration {}, messages: {}", iteration, messages.len()));

        let (text, tool_calls, _stop) = if is_anthropic {
            call_anthropic(&client, api_key, model, system, &messages, &formatted_tools).await?
        } else {
            call_openai(&client, api_key, model, system, &messages, &formatted_tools).await?
        };

        // No tool calls — this is the final answer
        if tool_calls.is_empty() {
            return Ok((text.unwrap_or_default(), trace));
        }

        // Append the assistant message carrying the tool calls
        if is_anthropic {
            let mut content_blocks: Vec<Value> = Vec::new();
            if let Some(t) = &text {
                content_blocks.push(json!({"type": "text", "text": t}));
            }
            for (id, name, input) in &tool_calls {
                content_blocks.push(json!({"type": "tool_use", "id": id, "name": name, "input": input}));
            }
            messages.push(json!({"role": "assistant", "content": content_blocks}));
        } else {
            let tc_array: Vec<Value> = tool_calls.iter().map(|(id, name, args)| {
                json!({
                    "id": id, "type": "function",
                    "function": {"name": name, "arguments": serde_json::to_string(args).unwrap_or_default()}
                })
            }).collect();
            messages.push(json!({"role": "assistant", "content": text, "tool_calls": tc_array}));
        }

        // Execute every call — the allowlist guarantees they are safe reads
        let mut anthropic_results: Vec<Value> = Vec::new();
        for (id, name, args) in &tool_calls {
            let result = execute_tool_async(name, args, db).await;
            crate::services::logger::log("info", &format!("[agent:loop] tool {}({}) -> {}", name, args, crate::services::logger::snippet(&result, 200)));
            trace.push(ToolCallLog {
                tool_name: name.clone(),
                arguments: args.clone(),
                result: result.clone(),
            });
            if is_anthropic {
                anthropic_results.push(json!({"type": "tool_result", "tool_use_id": id, "content": result}));
            } else {
                messages.push(json!({"role": "tool", "tool_call_id": id, "content": result}));
            }
        }
        if is_anthropic && !anthropic_results.is_empty() {
            messages.push(json!({"role": "user", "content": anthropic_results}));
        }
    }

    // Iteration cap hit — one final call and take whatever text comes back
    let (text, _, _) = if is_anthropic {
        call_anthropic(&client, api_key, model, system, &messages, &formatted_tools).await?
    } else {
        call_openai(&client, api_key, model, system, &messages, &formatted_tools).await?
    };
    Ok((text.unwrap_or_default(), trace))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connection::init_test_db;

    /// Two projects and three tasks: one named after the thing, one that only
    /// mentions it in a comment, one unrelated.
    fn workspace() -> Connection {
        let conn = init_test_db();
        conn.execute_batch(
            "INSERT INTO projects (id, name) VALUES ('inbox-p', 'Разное'), ('idchess', 'IdChess');
             INSERT INTO tasks (id, title, project_id, status) VALUES
               ('t1', 'Созвон по idChess', 'inbox-p', 'queue'),
               ('t2', 'Разобрать доску', 'inbox-p', 'queue'),
               ('t3', 'Отчёт за неделю', 'inbox-p', 'queue');
             UPDATE tasks SET comment = 'обсудили idChess и сроки' WHERE id = 't2';",
        )
        .unwrap();
        conn
    }

    fn project_of(conn: &Connection, task_id: &str) -> Option<String> {
        conn.query_row("SELECT project_id FROM tasks WHERE id = ?1", [task_id], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn update_task_moves_a_task_to_another_project() {
        let conn = workspace();
        let result = execute_tool_sync(
            &conn,
            "update_task",
            &json!({ "task_id": "t1", "project_id": "idchess" }),
        )
        .unwrap();
        assert!(result.contains("t1"), "{}", result);
        assert_eq!(project_of(&conn, "t1").as_deref(), Some("idchess"));
    }

    #[test]
    fn a_project_that_does_not_exist_is_refused() {
        let conn = workspace();
        let error = execute_tool_sync(
            &conn,
            "update_task",
            &json!({ "task_id": "t1", "project_id": "does-not-exist" }),
        )
        .unwrap_err();
        assert!(error.contains("No project"), "{}", error);
        // The task stays exactly where it was.
        assert_eq!(project_of(&conn, "t1").as_deref(), Some("inbox-p"));
    }

    #[test]
    fn search_looks_beyond_the_title() {
        let conn = workspace();
        let found = execute_tool_sync(&conn, "search_tasks", &json!({ "query": "idChess" })).unwrap();
        assert!(found.contains("t1"), "the title match is missing: {}", found);
        assert!(found.contains("t2"), "the comment match is missing: {}", found);
        assert!(!found.contains("t3"), "an unrelated task was returned: {}", found);
    }

    #[test]
    fn cancel_reports_whether_the_run_was_live() {
        let id = "test-run-cancel";
        let _signal = register_run(id);
        assert!(cancel_run(id), "a registered run must report as stopped");
        assert!(!cancel_run(id), "a run can only be stopped once");
        assert!(!cancel_run("never-registered"));
    }

    #[tokio::test]
    async fn cancel_wakes_a_waiter_even_if_it_arrives_first() {
        let id = "test-run-race";
        let signal = register_run(id);
        // Stop lands before anyone awaits - the permit must survive.
        assert!(cancel_run(id));
        tokio::time::timeout(std::time::Duration::from_secs(1), signal.notified())
            .await
            .expect("notified() must return immediately on a stored permit");
    }

    #[test]
    fn finish_run_leaves_nothing_to_cancel() {
        let id = "test-run-finish";
        let _signal = register_run(id);
        finish_run(id);
        assert!(!cancel_run(id));
    }
}
