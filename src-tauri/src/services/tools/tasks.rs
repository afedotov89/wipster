//! Everything the user can do to a task, as tools.

use rusqlite::Connection;
use serde_json::{json, Value};

use super::{record, task_snapshot, Availability, Danger, Handler, Tool};

pub fn create_task(conn: &Connection, args: &Value) -> Result<String, String> {
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

pub fn update_task(conn: &Connection, args: &Value) -> Result<String, String> {
    let task_id = args["task_id"].as_str().ok_or("missing task_id")?;
    let old_snap = task_snapshot(conn, task_id);

    let mut updates = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    for field in ["title", "priority", "due", "time_estimate", "dod", "next_step", "promised_to", "comment", "tracker_url", "energy", "estimate"] {
        if let Some(val) = args[field].as_str() {
            updates.push(format!("{} = ?", field));
            params.push(Box::new(val.to_string()));
        }
    }

    // The checklist is a list in the UI and a JSON column in the database, so
    // it arrives as a list and is stored as text. Passing the whole list is
    // what lets the assistant tick one item off: read it, flip one `done`,
    // write it back.
    if let Some(items) = args["checklist"].as_array() {
        let cleaned: Vec<Value> = items
            .iter()
            .filter_map(|item| {
                let text = item["text"].as_str()?.trim();
                (!text.is_empty()).then(|| {
                    json!({ "text": text, "done": item["done"].as_bool().unwrap_or(false) })
                })
            })
            .collect();
        updates.push("checklist = ?".to_string());
        params.push(Box::new(serde_json::to_string(&cleaned).unwrap_or_else(|_| "[]".to_string())));
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

pub fn move_task(conn: &Connection, args: &Value) -> Result<String, String> {
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

pub fn delete_task(conn: &Connection, args: &Value) -> Result<String, String> {
    let task_id = args["task_id"].as_str().ok_or("missing task_id")?;
    let old_snap = task_snapshot(conn, task_id);
    conn.execute("DELETE FROM tasks WHERE id = ?1", [task_id]).map_err(|e| e.to_string())?;
    record(conn, "delete", "task", task_id, old_snap.as_deref(), None);
    Ok(format!("Deleted task {}", task_id))
}

pub fn set_task_archived(conn: &Connection, args: &Value) -> Result<String, String> {
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

pub fn search_tasks(conn: &Connection, args: &Value) -> Result<String, String> {
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

pub fn list_tasks(conn: &Connection, args: &Value) -> Result<String, String> {
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

pub fn get_task(conn: &Connection, args: &Value) -> Result<String, String> {
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

pub fn tools() -> Vec<Tool> {
    vec![
        Tool {
            name: "create_task",
            summary: "Create a new task",
            keywords: &["задача", "создать", "добавить", "new task", "create", "add"],
            availability: Availability::Core,
            danger: Danger::Safe,
            params: || json!({
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
            }),
            handler: Handler::Db(create_task),
        },
        Tool {
            name: "update_task",
            summary: "Update fields of an existing task",
            keywords: &[
                "задача", "изменить", "поле", "срок", "оценка", "приоритет", "чек-лист", "шаги",
                "отметить", "перенести в проект", "энергия",
                "edit", "field", "due", "estimate", "priority", "checklist", "steps", "tick",
                "move to project", "energy",
            ],
            availability: Availability::Core,
            danger: Danger::Safe,
            params: || json!({
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
                    "energy": { "type": "string", "enum": ["low","medium","high"] },
                    "estimate": { "type": "string", "enum": ["s","m","l"], "description": "T-shirt size" },
                    "checklist": {
                        "type": "array",
                        "description": "The whole checklist, replacing the old one. Read it with get_task first to keep the items already ticked.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "text": { "type": "string" },
                                "done": { "type": "boolean" }
                            },
                            "required": ["text"]
                        }
                    },
                },
                "required": ["task_id"]
            }),
            handler: Handler::Db(update_task),
        },
        Tool {
            name: "move_task",
            summary: "Change task status (inbox/queue/doing/done)",
            keywords: &["статус", "в работу", "готово", "очередь", "status", "start", "done", "queue"],
            availability: Availability::Core,
            danger: Danger::Safe,
            params: || json!({
                "type": "object",
                "properties": {
                    "task_id": { "type": "string" },
                    "new_status": { "type": "string", "enum": ["inbox","queue","doing","done"] },
                },
                "required": ["task_id", "new_status"]
            }),
            handler: Handler::Db(move_task),
        },
        Tool {
            name: "delete_task",
            summary: "Delete a task permanently",
            keywords: &["удалить задачу", "delete task", "remove"],
            availability: Availability::OnDemand,
            danger: Danger::Confirm,
            params: || json!({
                "type": "object",
                "properties": { "task_id": { "type": "string" } },
                "required": ["task_id"]
            }),
            handler: Handler::Db(delete_task),
        },
        Tool {
            name: "set_task_archived",
            summary: "Archive a task (hides it from the board without deleting it) or restore it from the archive. Use for stale tasks nobody intends to do.",
            keywords: &["архив", "заархивировать", "вернуть из архива", "archive", "restore"],
            availability: Availability::OnDemand,
            danger: Danger::Safe,
            params: || json!({
                "type": "object",
                "properties": {
                    "task_id": { "type": "string" },
                    "archived": { "type": "boolean", "description": "true = move to archive, false = restore to the board" },
                },
                "required": ["task_id", "archived"]
            }),
            handler: Handler::Db(set_task_archived),
        },
        Tool {
            name: "search_tasks",
            summary: "Search tasks by text, project, or status. The text is matched against the title, definition of done, comment, next step and tracker link",
            keywords: &["найти", "поиск", "search", "find task"],
            availability: Availability::Core,
            danger: Danger::Safe,
            params: || json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Text to search in title" },
                    "project_id": { "type": "string" },
                    "status": { "type": "string", "enum": ["inbox","queue","doing","done"] },
                },
            }),
            handler: Handler::Db(search_tasks),
        },
        Tool {
            name: "list_tasks",
            summary: "List tasks, optionally filtered by project and/or status. Use when user asks 'what tasks do I have', 'show my tasks', 'what's in progress', etc.",
            keywords: &["список", "какие задачи", "list", "board", "доска"],
            availability: Availability::Core,
            danger: Danger::Safe,
            params: || json!({
                "type": "object",
                "properties": {
                    "project_id": { "type": "string", "description": "Filter by project" },
                    "status": { "type": "string", "enum": ["inbox","queue","doing","done"], "description": "Filter by status" },
                },
            }),
            handler: Handler::Db(list_tasks),
        },
        Tool {
            name: "get_task",
            summary: "Get full details of a task by ID",
            keywords: &["детали", "подробности", "открыть задачу", "details", "task"],
            availability: Availability::Core,
            danger: Danger::Safe,
            params: || json!({
                "type": "object",
                "properties": { "task_id": { "type": "string" } },
                "required": ["task_id"]
            }),
            handler: Handler::Db(get_task),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connection::init_test_db;
    use serde_json::json;

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
    fn the_checklist_can_be_ticked_off() {
        let conn = workspace();
        update_task(
            &conn,
            &json!({
                "task_id": "t1",
                "checklist": [
                    { "text": "созвон", "done": true },
                    { "text": "письмо" },
                    { "text": "   " }
                ]
            }),
        )
        .unwrap();

        let stored: String = conn
            .query_row("SELECT checklist FROM tasks WHERE id = 't1'", [], |r| r.get(0))
            .unwrap();
        let items: Vec<serde_json::Value> = serde_json::from_str(&stored).unwrap();
        assert_eq!(items.len(), 2, "the blank item is dropped: {}", stored);
        assert_eq!(items[0]["done"], true);
        assert_eq!(items[1]["done"], false, "an item without `done` starts unticked");
    }

    #[test]
    fn update_task_moves_a_task_to_another_project() {
        let conn = workspace();
        let result = update_task(
            &conn,
            &json!({ "task_id": "t1", "project_id": "idchess" }),
        )
        .unwrap();
        assert!(result.contains("t1"), "{}", result);
        assert_eq!(project_of(&conn, "t1").as_deref(), Some("idchess"));
    }

    #[test]
    fn a_project_that_does_not_exist_is_refused() {
        let conn = workspace();
        let error = update_task(
            &conn,
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
        let found = search_tasks(&conn, &json!({ "query": "idChess" })).unwrap();
        assert!(found.contains("t1"), "the title match is missing: {}", found);
        assert!(found.contains("t2"), "the comment match is missing: {}", found);
        assert!(!found.contains("t3"), "an unrelated task was returned: {}", found);
    }

}
