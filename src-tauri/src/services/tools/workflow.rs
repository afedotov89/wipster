//! Tools for the things around the board: the archive, ordering, undo, history
//! and the WIP limit.

use rusqlite::Connection;
use serde_json::{json, Value};

use super::{Availability, Danger, Handler, Tool};

pub fn list_archived_tasks(conn: &Connection, _args: &Value) -> Result<String, String> {
    let mut stmt = conn
        .prepare(
            "SELECT t.id, t.title, COALESCE(p.name, ''), t.archived_at FROM tasks t \
             LEFT JOIN projects p ON t.project_id = p.id \
             WHERE t.archived_at IS NOT NULL ORDER BY t.archived_at DESC LIMIT 50",
        )
        .map_err(|e| e.to_string())?;

    let rows: Vec<String> = stmt
        .query_map([], |row| {
            Ok(format!(
                "- {} | {} | {} | archived {}",
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?.chars().take(10).collect::<String>(),
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(if rows.is_empty() {
        "The archive is empty".to_string()
    } else {
        rows.join("\n")
    })
}

pub fn reorder_tasks(conn: &Connection, args: &Value) -> Result<String, String> {
    let ids: Vec<String> = args["task_ids"]
        .as_array()
        .ok_or("missing task_ids")?
        .iter()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect();
    if ids.is_empty() {
        return Err("task_ids is empty".to_string());
    }

    for (position, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE tasks SET position = ?1, updated_at = datetime('now') WHERE id = ?2",
            rusqlite::params![position as i32, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(format!("Reordered {} tasks", ids.len()))
}

pub fn undo_last(conn: &Connection, _args: &Value) -> Result<String, String> {
    let batch = crate::services::undo_redo::get_undo_batch(conn).map_err(|e| e.to_string())?;
    if batch.is_empty() {
        return Ok("Nothing to undo".to_string());
    }
    let described = describe(&batch[0]);
    for entry in &batch {
        crate::services::undo_redo::apply_undo(conn, entry)?;
    }
    Ok(format!("Undid: {}", described))
}

pub fn redo_last(conn: &Connection, _args: &Value) -> Result<String, String> {
    let batch = crate::services::undo_redo::get_redo_batch(conn).map_err(|e| e.to_string())?;
    if batch.is_empty() {
        return Ok("Nothing to redo".to_string());
    }
    let described = describe(&batch[batch.len() - 1]);
    for entry in &batch {
        crate::services::undo_redo::apply_redo(conn, entry)?;
    }
    Ok(format!("Redid: {}", described))
}

pub fn recent_changes(conn: &Connection, args: &Value) -> Result<String, String> {
    let limit = args["limit"].as_i64().unwrap_or(15).clamp(1, 50);
    let mut stmt = conn
        .prepare(
            "SELECT created_at, action, entity_type, entity_id FROM changelog \
             WHERE undone = 0 ORDER BY created_at DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let rows: Vec<String> = stmt
        .query_map([limit], |row| {
            Ok(format!(
                "- {} {} {} {}",
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(if rows.is_empty() {
        "No changes recorded yet".to_string()
    } else {
        rows.join("\n")
    })
}

pub fn get_wip_limit(conn: &Connection, _args: &Value) -> Result<String, String> {
    let limit = crate::services::wip_guard::wip_limit(conn);
    let doing = crate::services::wip_guard::check_wip(conn, None).doing_tasks.len();
    Ok(format!("WIP limit is {}; {} tasks are in progress", limit, doing))
}

pub fn set_wip_limit(conn: &Connection, args: &Value) -> Result<String, String> {
    let requested = args["limit"].as_i64().ok_or("missing limit")?;
    let stored = crate::services::wip_guard::clamp_wip_limit(requested.max(0) as usize);
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('wip_limit', ?1)",
        [stored.to_string()],
    )
    .map_err(|e| e.to_string())?;
    Ok(format!("WIP limit is now {}", stored))
}

fn describe(entry: &crate::models::changelog::ChangeLogEntry) -> String {
    format!("{} {}", entry.action, entry.entity_type)
}

pub fn tools() -> Vec<Tool> {
    vec![
        Tool {
            name: "list_archived_tasks",
            summary: "List archived tasks — the ones parked out of the way but not deleted",
            keywords: &["архив", "заархивированные", "archive", "archived"],
            availability: Availability::OnDemand,
            danger: Danger::Safe,
            params: || json!({ "type": "object", "properties": {} }),
            handler: Handler::Db(list_archived_tasks),
        },
        Tool {
            name: "reorder_tasks",
            summary: "Set the order of tasks within a column: pass the task ids in the order they should appear",
            keywords: &["порядок", "переставить", "сортировка", "order", "reorder", "sort", "move up"],
            availability: Availability::OnDemand,
            danger: Danger::Safe,
            params: || {
                json!({
                    "type": "object",
                    "properties": {
                        "task_ids": { "type": "array", "items": { "type": "string" }, "description": "Task ids, top first" }
                    },
                    "required": ["task_ids"]
                })
            },
            handler: Handler::Db(reorder_tasks),
        },
        Tool {
            name: "undo_last",
            summary: "Undo the last change made in the app, including one the assistant just made",
            keywords: &["отменить", "откатить", "верни как было", "undo", "revert"],
            availability: Availability::OnDemand,
            danger: Danger::Safe,
            params: || json!({ "type": "object", "properties": {} }),
            handler: Handler::Db(undo_last),
        },
        Tool {
            name: "redo_last",
            summary: "Redo the change that was last undone",
            keywords: &["вернуть", "повторить", "redo"],
            availability: Availability::OnDemand,
            danger: Danger::Safe,
            params: || json!({ "type": "object", "properties": {} }),
            handler: Handler::Db(redo_last),
        },
        Tool {
            name: "recent_changes",
            summary: "What was changed recently, newest first — useful for \"what did I do yesterday\"",
            keywords: &["история", "что менялось", "что я делал", "history", "changelog", "recent"],
            availability: Availability::OnDemand,
            danger: Danger::Safe,
            params: || {
                json!({
                    "type": "object",
                    "properties": { "limit": { "type": "integer", "description": "How many entries, up to 50" } }
                })
            },
            handler: Handler::Db(recent_changes),
        },
        Tool {
            name: "get_wip_limit",
            summary: "How many tasks may be in progress at once, and how many are right now",
            keywords: &["лимит", "wip", "в работе", "limit", "in progress"],
            availability: Availability::OnDemand,
            danger: Danger::Safe,
            params: || json!({ "type": "object", "properties": {} }),
            handler: Handler::Db(get_wip_limit),
        },
        Tool {
            name: "set_wip_limit",
            summary: "Change how many tasks may be in progress at once (1-20)",
            keywords: &["лимит", "wip", "поменяй лимит", "limit", "set limit"],
            availability: Availability::OnDemand,
            danger: Danger::Safe,
            params: || {
                json!({
                    "type": "object",
                    "properties": { "limit": { "type": "integer", "description": "New limit, 1 to 20" } },
                    "required": ["limit"]
                })
            },
            handler: Handler::Db(set_wip_limit),
        },
    ]
}
