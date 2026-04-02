use crate::models::task::Task;
use rusqlite::Connection;

/// Human-readable field name mapping
pub fn field_label(field: &str) -> &str {
    match field {
        "title" => "Task title",
        "dod" => "Definition of Done (acceptance criteria — when is this task finished?)",
        "next_step" => "Next concrete step to make progress on this task",
        "checklist" => "Checklist of sub-tasks",
        "tags" => "Tags/categories",
        "time_estimate" => "Time estimate",
        _ => field,
    }
}

/// Get integration credentials from settings
pub fn get_tracker_creds(conn: &Connection) -> Option<(String, String)> {
    let token = conn
        .query_row("SELECT value FROM settings WHERE key = 'tracker_token'", [], |r| r.get::<_, String>(0))
        .ok()?;
    let org_id = conn
        .query_row("SELECT value FROM settings WHERE key = 'tracker_org_id'", [], |r| r.get::<_, String>(0))
        .ok()?;
    if token.is_empty() || org_id.is_empty() {
        return None;
    }
    Some((token, org_id))
}

/// Build full task context string for LLM (sync part, without tracker enrichment)
pub fn task_context(conn: &Connection, task: &Task) -> String {
    let project_name = task.project_id.as_ref().and_then(|pid| {
        conn.query_row("SELECT name FROM projects WHERE id = ?1", [pid], |r| r.get::<_, String>(0)).ok()
    }).unwrap_or_else(|| "—".to_string());

    let sibling_tasks: Vec<String> = task.project_id.as_ref().map(|pid| {
        let mut stmt = conn.prepare(
            "SELECT title, status FROM tasks WHERE project_id = ?1 AND id != ?2 LIMIT 10"
        ).unwrap();
        stmt.query_map(rusqlite::params![pid, task.id], |row| {
            Ok(format!("- {} ({})", row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }).unwrap().filter_map(|r| r.ok()).collect()
    }).unwrap_or_default();

    let mut ctx = format!(
        r#"## Current Task
- **Title**: {}
- **Project**: {}
- **Status**: {}
- **Priority**: {}
- **Due**: {}
- **Size estimate**: {}
- **Time estimate**: {}
- **Definition of Done**: {}
- **Next step**: {}
- **Promised to**: {}"#,
        task.title,
        project_name,
        task.status,
        task.priority.as_deref().unwrap_or("not set"),
        task.due.as_deref().unwrap_or("not set"),
        task.estimate.as_deref().unwrap_or("not set"),
        task.time_estimate.as_deref().unwrap_or("not set"),
        task.dod.as_deref().unwrap_or("not set"),
        task.next_step.as_deref().unwrap_or("not set"),
        task.promised_to.as_deref().unwrap_or("not set"),
    );

    if !sibling_tasks.is_empty() {
        ctx.push_str("\n\n## Other tasks in this project\n");
        ctx.push_str(&sibling_tasks.join("\n"));
    }

    ctx
}
