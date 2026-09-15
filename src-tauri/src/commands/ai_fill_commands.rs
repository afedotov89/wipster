use tauri::State;

use crate::db::connection::DbState;
use crate::models::task::{task_from_row, Task, TASK_COLUMNS};
use crate::services::llm_context;

#[derive(serde::Serialize, serde::Deserialize)]
pub struct AiFillResult {
    /// Only set when the old title was a bare tracker reference and the ticket
    /// gave a real subject to replace it with.
    pub title: Option<String>,
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
    let (cfg, system_prompt, tracker_url_fill, title_is_placeholder) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;

        let cfg = crate::services::llm::LlmConfig::read(&conn)?;

        let task: Task = conn.query_row(
            &format!("SELECT {} FROM tasks WHERE id = ?1", TASK_COLUMNS),
            [&task_id],
            task_from_row,
        ).map_err(|e| format!("Task not found: {}", e))?;

        let task_ctx = llm_context::task_context(&conn, &task);
        // From the connection in hand: this block holds the lock, and asking
        // the mutex for it a second time would deadlock the command.
        let credentials = crate::services::issues::Credentials::read(&conn);

        // The issue link is filled deterministically (not by the LLM): if the
        // field is empty but the task's text points at an issue — in any
        // connected system — that is the link.
        let refs_text = format!(
            "{} {} {}",
            task.title,
            task.dod.as_deref().unwrap_or(""),
            task.next_step.as_deref().unwrap_or(""),
        );
        let tracker_url_fill = if task.tracker_url.as_deref().unwrap_or("").is_empty() {
            crate::services::issues::first_reference_url(&refs_text, &credentials)
        } else {
            None
        };

        // A title that is only a link says nothing about the work: the issue's
        // own title replaces it, and the link lives on in tracker_url.
        let title_is_placeholder =
            crate::services::issues::is_bare_reference(&task.title, &credentials);

        // Gather examples: completed tasks from same project with filled fields
        let examples = gather_examples(&conn, task.project_id.as_deref());

        // Determine which fields need filling
        let mut empty_fields = Vec::new();
        if title_is_placeholder { empty_fields.push("title"); }
        if task.time_estimate.as_ref().map(|s| s.is_empty()).unwrap_or(true) { empty_fields.push("time_estimate"); }
        if task.dod.as_ref().map(|s| s.is_empty()).unwrap_or(true) { empty_fields.push("dod"); }
        if task.priority.is_none() { empty_fields.push("priority"); }
        let checklist: Vec<serde_json::Value> = serde_json::from_str(&task.checklist).unwrap_or_default();
        if checklist.is_empty() { empty_fields.push("checklist"); }

        if empty_fields.is_empty() {
            return Ok(AiFillResult {
                title: None, time_estimate: None, dod: None, priority: None,
                promised_to: None, checklist: None, tracker_url: tracker_url_fill,
            });
        }

        let system_prompt = format!(
            r#"You are an AI assistant that fills in missing task fields based on context and examples.

{task_ctx}

{examples}

Empty fields to fill: {fields}

You have read-only tools to gather more context. Use them BEFORE answering when helpful:
- read_issue: if the task title or any field references an issue — a Yandex Tracker key or link (KEY-123), a GitLab link or group/project#42 — read it and base the fields on the real issue, never on a bare URL.
- search_tasks / list_tasks: to find how similar tasks were estimated and broken down.

After gathering context, respond with ONLY valid JSON as your final message, no markdown:
{{
  "title": "the task's real subject (or null)",
  "time_estimate": "e.g. 30м, 1ч, 2ч, 4ч, 1д (or null)",
  "dod": "one short criterion, max 15 words (or null)",
  "priority": "p0|p1|p2|p3 (or null)",
  "promised_to": null,
  "checklist": "[{{\"text\":\"step\",\"done\":false}}, ...] max 3-4 short steps (or null)"
}}

Rules:
- BE BRIEF. Every value must be as short as possible
- Only fill fields listed in empty_fields, set others to null
- title: only when listed. The current title is nothing but a tracker link, so read the issue and take its title: keep its wording and language, drop the issue code and any queue prefix, max 12 words. If the issue cannot be read, return null — never build a title out of the URL itself
- promised_to: ALWAYS null
- dod: one sentence, max 15 words
- checklist: max 4 steps, each max 8 words
- time_estimate: use same units as examples (ч, д, м)
- Use the same language as the task title"#,
            task_ctx = task_ctx,
            examples = examples,
            fields = empty_fields.join(", "),
        );

        (cfg, system_prompt, tracker_url_fill, title_is_placeholder)
    };

    // Run a tool-use loop with a read-only toolset so the model can pull in
    // tracker issues / similar tasks before producing the JSON answer.
    const FILL_TOOLS: &[&str] = &["read_issue", "search_tasks", "list_tasks", "get_task"];
    let user_msg = "Fill the empty fields. Use tools to gather context, then reply with only the JSON.";
    let text = crate::services::agent::run_tool_loop(
        &cfg, &system_prompt, user_msg, FILL_TOOLS, &db.0,
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

    let title = accept_title(title_is_placeholder, raw["title"].as_str());

    let result = AiFillResult {
        title,
        time_estimate: raw["time_estimate"].as_str().filter(|s| !s.is_empty()).map(|s| s.to_string()),
        dod: raw["dod"].as_str().filter(|s| !s.is_empty()).map(|s| s.to_string()),
        priority: raw["priority"].as_str().filter(|s| !s.is_empty()).map(|s| s.to_string()),
        promised_to: raw["promised_to"].as_str().filter(|s| !s.is_empty()).map(|s| s.to_string()),
        checklist,
        tracker_url: tracker_url_fill,
    };

    Ok(result)
}

/// The model gets one job on the title and no licence to rename anything else:
/// a title is taken only when we asked for one, and only when it reads as a
/// subject rather than handing the same link back.
fn accept_title(asked_for: bool, proposed: Option<&str>) -> Option<String> {
    if !asked_for {
        return None;
    }
    proposed
        .map(str::trim)
        .filter(|t| !t.is_empty() && t.chars().count() <= 200)
        .filter(|t| !crate::services::tracker::is_bare_issue_reference(t))
        .map(str::to_string)
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

#[cfg(test)]
mod tests {
    use super::accept_title;

    #[test]
    fn a_title_the_user_wrote_is_never_touched() {
        assert_eq!(accept_title(false, Some("Совсем другой заголовок")), None);
    }

    #[test]
    fn a_placeholder_title_takes_the_ticket_subject() {
        assert_eq!(
            accept_title(true, Some("  Оценка интеграции с Яндекс ID  ")),
            Some("Оценка интеграции с Яндекс ID".to_string()),
        );
    }

    #[test]
    fn the_same_link_back_is_not_a_title() {
        assert_eq!(accept_title(true, Some("RAGSERVIS-226")), None);
        assert_eq!(accept_title(true, Some("https://tracker.yandex.ru/RAGSERVIS-226")), None);
    }

    #[test]
    fn nothing_useful_leaves_the_title_alone() {
        assert_eq!(accept_title(true, None), None);
        assert_eq!(accept_title(true, Some("   ")), None);
        assert_eq!(accept_title(true, Some(&"я".repeat(201))), None);
    }
}
