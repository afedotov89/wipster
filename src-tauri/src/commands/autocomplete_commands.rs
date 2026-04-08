use tauri::State;

use crate::db::connection::DbState;
use crate::models::task::Task;
use crate::services::llm_context;

#[tauri::command]
pub async fn ai_autocomplete(
    db: State<'_, DbState>,
    task_id: String,
    field_name: String,
    current_value: String,
) -> Result<String, String> {
    let (provider, api_key, model, system_prompt_base, tracker_creds, task) = {
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
                promised_to: row.get(14)?, comment: row.get(15)?, tracker_url: row.get(16)?, position: row.get(17)?, completed_at: row.get(18)?, created_at: row.get(19)?, updated_at: row.get(20)?,
            }),
        ).map_err(|e| format!("Task not found: {}", e))?;

        let task_ctx = llm_context::task_context(&conn, &task);
        let field_label = llm_context::field_label(&field_name);

        let user_input = current_value.replace('/', "").trim().to_string();
        let input_hint = if user_input.is_empty() {
            String::new()
        } else {
            format!("\nUser already started typing: \"{}\"", user_input)
        };

        let tracker_creds = llm_context::get_tracker_creds(&conn);

        let system_prompt_base = format!(
            r#"You are an autocomplete assistant inside a task manager app.
Your job: generate the value for the field "{field_label}" based on the task context below.

{task_ctx}

Rules:
- Output ONLY the field value — no quotes, no explanation, no markdown, no preamble
- MAXIMUM 1-2 short sentences. Be extremely brief and specific
- If the field is "Definition of Done": one concrete criterion, max 10 words
- If the field is "Next step": one specific action, max 10 words
- Never repeat the task title in the answer
- Use the same language as the task title{input_hint}"#
        );

        (provider, api_key, model, system_prompt_base, tracker_creds, task)
    };

    // Enrich with tracker context if credentials available
    let tracker_context = if let Some((token, org_id)) = &tracker_creds {
        crate::services::tracker::enrich_context(
            token, org_id,
            &[Some(task.title.as_str()), task.dod.as_deref(), task.next_step.as_deref()],
        ).await
    } else {
        String::new()
    };

    let system_prompt = if tracker_context.is_empty() {
        system_prompt_base
    } else {
        format!("{}\n\n{}", system_prompt_base, tracker_context)
    };

    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(60)).build().map_err(|e| e.to_string())?;
    let user_msg = "Fill in the field value:";
    let start = std::time::Instant::now();

    crate::services::logger::log("info", &format!("[autocomplete] START field={}, provider={}, model={}, prompt_len={}",
        field_name, provider, model, system_prompt.len()));

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
            .json(&body).send().await.map_err(|e| {
                crate::services::logger::log("info", &format!("[autocomplete] HTTP error after {:.1}s: {}", start.elapsed().as_secs_f32(), e));
                e.to_string()
            })?;
        let status = resp.status();
        crate::services::logger::log("info", &format!("[autocomplete] response status={} after {:.1}s", status, start.elapsed().as_secs_f32()));
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            crate::services::logger::log("info", &format!("[autocomplete] API error body: {}", &body[..body.len().min(500)]));
            return Err(format!("API error {}: {}", status, body));
        }
        let j: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        let content = j["choices"][0]["message"]["content"].as_str().unwrap_or("");
        let reasoning = j["choices"][0]["message"]["reasoning"].as_str().unwrap_or("");
        let finish = j["choices"][0]["finish_reason"].as_str().unwrap_or("");
        let usage = &j["usage"];
        crate::services::logger::log("info", &format!("[autocomplete] finish={}, content_len={}, reasoning_len={}, usage={}",
            finish, content.len(), reasoning.len(), usage));
        content.trim().to_string()
    } else {
        let body = serde_json::json!({
            "model": model,
            "max_tokens": 200,
            "temperature": 0.3,
            "system": system_prompt,
            "messages": [{ "role": "user", "content": user_msg }]
        });
        let resp = client.post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body).send().await.map_err(|e| {
                crate::services::logger::log("info", &format!("[autocomplete] HTTP error after {:.1}s: {}", start.elapsed().as_secs_f32(), e));
                e.to_string()
            })?;
        let status = resp.status();
        crate::services::logger::log("info", &format!("[autocomplete] response status={} after {:.1}s", status, start.elapsed().as_secs_f32()));
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            crate::services::logger::log("info", &format!("[autocomplete] API error body: {}", &body[..body.len().min(500)]));
            return Err(format!("API error {}: {}", status, body));
        }
        let j: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        j["content"][0]["text"].as_str().unwrap_or("").trim().to_string()
    };

    crate::services::logger::log("info", &format!("[autocomplete] DONE field={}, result_len={}, elapsed={:.1}s, result='{}'",
        field_name, text.len(), start.elapsed().as_secs_f32(), &text[..text.len().min(100)]));

    Ok(text)
}
