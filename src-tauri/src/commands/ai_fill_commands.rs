use tauri::State;

use crate::db::connection::DbState;
use crate::models::task::{task_from_row, Task, TASK_COLUMNS};
use crate::services::llm_context;

#[derive(serde::Serialize, serde::Deserialize)]
pub struct AiFillResult {
    pub time_estimate: Option<String>,
    pub dod: Option<String>,
    pub priority: Option<String>,
    pub promised_to: Option<String>,
    pub checklist: Option<String>,
    pub tracker_url: Option<String>,
}

#[tauri::command]
pub async fn ai_fill_task(
    db: State<'_, DbState>,
    task_id: String,
) -> Result<AiFillResult, String> {
    let (provider, api_key, model, system_prompt, tracker_url_fill) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;

        let provider = conn
            .query_row("SELECT value FROM settings WHERE key = 'llm_provider'", [], |r| r.get::<_, String>(0))
            .unwrap_or_else(|_| "anthropic".to_string());

        let key_name = if provider == "openrouter" { "openrouter_api_key" } else { "anthropic_api_key" };
        let api_key: String = conn
            .query_row("SELECT value FROM settings WHERE key = ?1", [key_name], |r| r.get(0))
            .map_err(|_| "API_KEY_NOT_SET")?;

        let default_model = if provider == "openrouter" { "anthropic/claude-sonnet-4" } else { "claude-sonnet-4-20250514" };
        let model = conn
            .query_row("SELECT value FROM settings WHERE key = 'llm_model'", [], |r| r.get::<_, String>(0))
            .unwrap_or_else(|_| default_model.to_string());

        let task: Task = conn.query_row(
            &format!("SELECT {} FROM tasks WHERE id = ?1", TASK_COLUMNS),
            [&task_id],
            task_from_row,
        ).map_err(|e| format!("Task not found: {}", e))?;

        let task_ctx = llm_context::task_context(&conn, &task);

        // tracker_url is filled deterministically (not by the LLM): if the field
        // is empty but the task's text references a tracker issue, use that.
        let tracker_url_fill = if task.tracker_url.as_deref().unwrap_or("").is_empty() {
            let refs_text = format!(
                "{} {} {}",
                task.title,
                task.dod.as_deref().unwrap_or(""),
                task.next_step.as_deref().unwrap_or(""),
            );
            crate::services::tracker::find_tracker_refs(&refs_text)
                .first()
                .map(|k| format!("https://tracker.yandex.ru/{}", k))
        } else {
            None
        };

        // Gather examples: completed tasks from same project with filled fields
        let examples = gather_examples(&conn, task.project_id.as_deref());

        // Determine which fields need filling
        let mut empty_fields = Vec::new();
        if task.time_estimate.as_ref().map(|s| s.is_empty()).unwrap_or(true) { empty_fields.push("time_estimate"); }
        if task.dod.as_ref().map(|s| s.is_empty()).unwrap_or(true) { empty_fields.push("dod"); }
        if task.priority.is_none() { empty_fields.push("priority"); }
        let checklist: Vec<serde_json::Value> = serde_json::from_str(&task.checklist).unwrap_or_default();
        if checklist.is_empty() { empty_fields.push("checklist"); }

        if empty_fields.is_empty() {
            return Ok(AiFillResult {
                time_estimate: None, dod: None, priority: None,
                promised_to: None, checklist: None, tracker_url: tracker_url_fill,
            });
        }

        let system_prompt = format!(
            r#"You are an AI assistant that fills in missing task fields based on context and examples.

{task_ctx}

{examples}

Empty fields to fill: {fields}

You have read-only tools to gather more context. Use them BEFORE answering when helpful:
- read_tracker_issue: if the task title or any field references a Yandex Tracker issue (a tracker.yandex.ru link or a KEY-123 code), read it to base the fields on the real ticket — never guess from a bare URL.
- search_tasks / list_tasks: to find how similar tasks were estimated and broken down.

After gathering context, respond with ONLY valid JSON as your final message, no markdown:
{{
  "time_estimate": "e.g. 30м, 1ч, 2ч, 4ч, 1д (or null)",
  "dod": "one short criterion, max 15 words (or null)",
  "priority": "p0|p1|p2|p3 (or null)",
  "promised_to": null,
  "checklist": "[{{\"text\":\"step\",\"done\":false}}, ...] max 3-4 short steps (or null)"
}}

Rules:
- BE BRIEF. Every value must be as short as possible
- Only fill fields listed in empty_fields, set others to null
- promised_to: ALWAYS null
- dod: one sentence, max 15 words
- checklist: max 4 steps, each max 8 words
- time_estimate: use same units as examples (ч, д, м)
- Use the same language as the task title"#,
            task_ctx = task_ctx,
            examples = examples,
            fields = empty_fields.join(", "),
        );

        (provider, api_key, model, system_prompt, tracker_url_fill)
    };

    // Run a tool-use loop with a read-only toolset so the model can pull in
    // tracker issues / similar tasks before producing the JSON answer.
    const FILL_TOOLS: &[&str] = &["read_tracker_issue", "search_tasks", "list_tasks", "get_task"];
    let user_msg = "Fill the empty fields. Use tools to gather context, then reply with only the JSON.";
    let text = crate::services::agent::run_tool_loop(
        &provider, &api_key, &model, &system_prompt, user_msg, FILL_TOOLS, &db.0,
    ).await?;

    // Parse JSON from response
    let cleaned = if let Some(start) = text.find('{') {
        let end = text.rfind('}').unwrap_or(text.len() - 1);
        &text[start..=end]
    } else {
        &text
    };

    let raw: serde_json::Value = serde_json::from_str(cleaned)
        .map_err(|e| format!("Parse error: {}. Raw: {}", e, text))?;

    // Handle checklist: LLM may return it as array or string
    let checklist = match &raw["checklist"] {
        serde_json::Value::Array(arr) => {
            if arr.is_empty() { None } else { Some(serde_json::to_string(arr).unwrap_or_default()) }
        }
        serde_json::Value::String(s) => {
            if s.is_empty() || s == "null" { None } else { Some(s.clone()) }
        }
        _ => None,
    };

    let result = AiFillResult {
        time_estimate: raw["time_estimate"].as_str().filter(|s| !s.is_empty()).map(|s| s.to_string()),
        dod: raw["dod"].as_str().filter(|s| !s.is_empty()).map(|s| s.to_string()),
        priority: raw["priority"].as_str().filter(|s| !s.is_empty()).map(|s| s.to_string()),
        promised_to: raw["promised_to"].as_str().filter(|s| !s.is_empty()).map(|s| s.to_string()),
        checklist,
        tracker_url: tracker_url_fill,
    };

    Ok(result)
}

fn gather_examples(conn: &rusqlite::Connection, project_id: Option<&str>) -> String {
    let mut examples = Vec::new();

    // Get completed tasks with filled fields from same project
    let sql = if project_id.is_some() {
        "SELECT title, priority, time_estimate, dod, checklist FROM tasks \
         WHERE project_id = ?1 AND status = 'done' AND (time_estimate IS NOT NULL OR dod IS NOT NULL) \
         ORDER BY updated_at DESC LIMIT 10"
    } else {
        "SELECT title, priority, time_estimate, dod, checklist FROM tasks \
         WHERE status = 'done' AND (time_estimate IS NOT NULL OR dod IS NOT NULL) \
         ORDER BY updated_at DESC LIMIT 10"
    };

    let result = if let Some(pid) = project_id {
        let mut stmt = conn.prepare(sql).ok();
        stmt.as_mut().map(|s| {
            s.query_map([pid], |row| {
                Ok(format!(
                    "- \"{}\": priority={}, time={}, dod={}",
                    row.get::<_, String>(0).unwrap_or_default(),
                    row.get::<_, Option<String>>(1).unwrap_or(None).unwrap_or_else(|| "—".to_string()),
                    row.get::<_, Option<String>>(2).unwrap_or(None).unwrap_or_else(|| "—".to_string()),
                    row.get::<_, Option<String>>(3).unwrap_or(None).unwrap_or_else(|| "—".to_string()),
                ))
            }).ok().map(|rows| rows.filter_map(|r| r.ok()).collect::<Vec<_>>())
        }).flatten()
    } else {
        let mut stmt = conn.prepare(sql).ok();
        stmt.as_mut().map(|s| {
            s.query_map([], |row| {
                Ok(format!(
                    "- \"{}\": priority={}, time={}, dod={}",
                    row.get::<_, String>(0).unwrap_or_default(),
                    row.get::<_, Option<String>>(1).unwrap_or(None).unwrap_or_else(|| "—".to_string()),
                    row.get::<_, Option<String>>(2).unwrap_or(None).unwrap_or_else(|| "—".to_string()),
                    row.get::<_, Option<String>>(3).unwrap_or(None).unwrap_or_else(|| "—".to_string()),
                ))
            }).ok().map(|rows| rows.filter_map(|r| r.ok()).collect::<Vec<_>>())
        }).flatten()
    };

    if let Some(rows) = result {
        examples = rows;
    }

    if examples.is_empty() {
        String::new()
    } else {
        format!("## Completed tasks for reference\n{}", examples.join("\n"))
    }
}
