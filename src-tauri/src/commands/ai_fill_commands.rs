use tauri::State;

use crate::db::connection::DbState;
use crate::models::task::Task;
use crate::services::llm_context;

#[derive(serde::Serialize, serde::Deserialize)]
pub struct AiFillResult {
    pub time_estimate: Option<String>,
    pub dod: Option<String>,
    pub priority: Option<String>,
    pub promised_to: Option<String>,
    pub checklist: Option<String>,
}

#[tauri::command]
pub async fn ai_fill_task(
    db: State<'_, DbState>,
    task_id: String,
) -> Result<AiFillResult, String> {
    let (provider, api_key, model, system_prompt) = {
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
            "SELECT id, title, project_id, status, priority, energy, due, estimate, time_estimate, tags, \
             dod, checklist, next_step, return_ref, promised_to, comment, tracker_url, position, completed_at, created_at, updated_at FROM tasks WHERE id = ?1",
            [&task_id],
            |row| Ok(Task {
                id: row.get(0)?, title: row.get(1)?, project_id: row.get(2)?,
                status: row.get(3)?, priority: row.get(4)?, energy: row.get(5)?, due: row.get(6)?,
                estimate: row.get(7)?, time_estimate: row.get(8)?, tags: row.get(9)?, dod: row.get(10)?,
                checklist: row.get(11)?, next_step: row.get(12)?, return_ref: row.get(13)?,
                promised_to: row.get(14)?, comment: row.get(15)?, tracker_url: row.get(16)?, position: row.get(17)?,
                completed_at: row.get(18)?, created_at: row.get(19)?, updated_at: row.get(20)?,
            }),
        ).map_err(|e| format!("Task not found: {}", e))?;

        let task_ctx = llm_context::task_context(&conn, &task);

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
            return Ok(AiFillResult { time_estimate: None, dod: None, priority: None, promised_to: None, checklist: None });
        }

        let system_prompt = format!(
            r#"You are an AI assistant that fills in missing task fields based on context and examples.

{task_ctx}

{examples}

Empty fields to fill: {fields}

Respond with ONLY valid JSON, no markdown:
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

        (provider, api_key, model, system_prompt)
    };

    let client = reqwest::Client::new();
    let user_msg = "Fill the empty fields:";

    let text = if provider == "openrouter" {
        let body = serde_json::json!({
            "model": model,
            "max_tokens": 2000,
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": user_msg }
            ]
        });
        let resp = client.post("https://openrouter.ai/api/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("content-type", "application/json")
            .json(&body).send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("API error: {}", resp.status()));
        }
        let j: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        j["choices"][0]["message"]["content"].as_str().unwrap_or("{}").to_string()
    } else {
        let body = serde_json::json!({
            "model": model,
            "max_tokens": 2000,
            "system": system_prompt,
            "messages": [{ "role": "user", "content": user_msg }]
        });
        let resp = client.post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body).send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("API error: {}", resp.status()));
        }
        let j: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        j["content"][0]["text"].as_str().unwrap_or("{}").to_string()
    };

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
