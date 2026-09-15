use tauri::State;

use crate::db::connection::DbState;
use crate::models::task::{task_from_row, Task, TASK_COLUMNS};
use crate::services::llm_context;

#[tauri::command]
pub async fn ai_autocomplete(
    db: State<'_, DbState>,
    task_id: String,
    field_name: String,
    current_value: String,
) -> Result<String, String> {
    let (cfg, system_prompt_base, tracker_creds, task) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;

        let cfg = crate::services::llm::LlmConfig::read(&conn)?;

        let task: Task = conn.query_row(
            &format!("SELECT {} FROM tasks WHERE id = ?1", TASK_COLUMNS),
            [&task_id],
            task_from_row,
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

        (cfg, system_prompt_base, tracker_creds, task)
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

    let user_msg = "Fill in the field value:";
    let start = std::time::Instant::now();

    crate::services::logger::log("info", &format!("[autocomplete] START field={}, provider={}, model={}, prompt_len={}",
        field_name, cfg.provider_id, cfg.model, system_prompt.len()));

    // One short answer, through the same path as every other feature — a field
    // suggestion has no business knowing what an API looks like.
    let text = crate::services::agent::complete(&cfg, &system_prompt, user_msg, 500).await?;

    crate::services::logger::log("info", &format!("[autocomplete] DONE field={}, result_len={}, elapsed={:.1}s, result='{}'",
        field_name, text.len(), start.elapsed().as_secs_f32(), crate::services::logger::snippet(&text, 100)));

    Ok(text)
}
