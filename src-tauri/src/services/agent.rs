use reqwest::Client;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Mutex;

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
            "name": "search_tasks",
            "description": "Search tasks by text query, project, or status",
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

fn task_snapshot(conn: &Connection, id: &str) -> Option<String> {
    conn.query_row(
        "SELECT id, title, project_id, status, priority, due, time_estimate, dod, promised_to, comment, tracker_url FROM tasks WHERE id = ?1",
        [id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "title": row.get::<_, String>(1)?,
                "project_id": row.get::<_, Option<String>>(2)?,
                "status": row.get::<_, String>(3)?,
                "priority": row.get::<_, Option<String>>(4)?,
                "due": row.get::<_, Option<String>>(5)?,
                "time_estimate": row.get::<_, Option<String>>(6)?,
                "dod": row.get::<_, Option<String>>(7)?,
                "promised_to": row.get::<_, Option<String>>(8)?,
                "comment": row.get::<_, Option<String>>(9)?,
                "tracker_url": row.get::<_, Option<String>>(10)?,
            }).to_string())
        },
    ).ok()
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

            conn.execute(
                "INSERT INTO tasks (id, title, project_id, status, priority, due, time_estimate, dod, promised_to, tracker_url) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                rusqlite::params![id, title, project_id, status, priority, due, time_estimate, dod, promised_to, tracker_url],
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
                let count: i32 = conn.query_row(
                    "SELECT COUNT(*) FROM tasks WHERE status = 'doing' AND id != ?1",
                    [task_id], |r| r.get(0),
                ).unwrap_or(0);
                if count >= 3 {
                    return Err("WIP limit reached (3 tasks in doing). Move another task out first.".to_string());
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
        "search_tasks" => {
            let query = args["query"].as_str().unwrap_or("");
            let project_id = args["project_id"].as_str();
            let status = args["status"].as_str();

            let mut sql = "SELECT id, title, status, priority, due, time_estimate FROM tasks WHERE 1=1".to_string();
            let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

            if !query.is_empty() {
                sql.push_str(" AND title LIKE ?");
                params.push(Box::new(format!("%{}%", query)));
            }
            if let Some(pid) = project_id {
                sql.push_str(" AND project_id = ?");
                params.push(Box::new(pid.to_string()));
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
                           LEFT JOIN projects p ON t.project_id = p.id WHERE 1=1".to_string();
            let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

            if let Some(pid) = project_id {
                sql.push_str(" AND t.project_id = ?");
                params.push(Box::new(pid.to_string()));
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
            let mut stmt = conn.prepare(
                "SELECT id, name FROM projects ORDER BY \"order\" ASC"
            ).map_err(|e| e.to_string())?;
            let rows: Vec<String> = stmt.query_map([], |row| {
                Ok(format!("- {} | {}", row.get::<_, String>(0)?, row.get::<_, String>(1)?))
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
        let msg = format!("[agent] API error {}: {}", status, &body[..body.len().min(300)]);
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
    let max_iterations = 10;

    for iteration in 0..max_iterations {
        crate::services::logger::log("info", &format!("[agent] iteration {}, messages: {}", iteration, messages.len()));

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
                let result = execute_tool_async(name, args, db).await;

                crate::services::logger::log("info", &format!("[agent] tool {}({}) -> {}", name, args, &result[..result.len().min(200)]));

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
