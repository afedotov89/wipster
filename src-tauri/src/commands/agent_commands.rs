use std::panic::AssertUnwindSafe;

use futures_util::FutureExt;
use tauri::{AppHandle, Emitter, State};

use crate::db::connection::DbState;
use crate::services::logger;
use crate::services::agent::{self, AgentResponse};

#[tauri::command]
pub fn get_backend_logs() -> Vec<String> {
    logger::drain()
}

#[tauri::command]
pub fn get_setting(db: State<'_, DbState>, key: String) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        [&key],
        |row| row.get::<_, String>(0),
    );
    match result {
        Ok(val) => Ok(Some(val)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn set_setting(db: State<'_, DbState>, key: String, value: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_setting_value(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
        row.get(0)
    })
    .ok()
}

/// Run the agent for one user message.
///
/// `run_id` comes from the UI: it tags the progress events this run emits and
/// is the handle [`agent_cancel`] uses to stop it.
#[tauri::command]
pub async fn agent_chat(
    app: AppHandle,
    db: State<'_, DbState>,
    run_id: String,
    message: String,
    focused_task_id: Option<String>,
    history: Option<Vec<(String, String)>>,
) -> Result<AgentResponse, String> {
    crate::services::logger::log("info", &format!("[agent_chat] received message: {}, focused_task: {:?}", message, focused_task_id));
    let (cfg, memory, focused_task_context) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;

        let cfg = crate::services::llm::LlmConfig::read(&conn)?;

        let memory = get_setting_value(&conn, "agent_memory").unwrap_or_default();

        let focused_task_context = focused_task_id.as_ref().and_then(|fid| {
            conn.query_row(
                "SELECT t.id, t.title, COALESCE(p.name, ''), t.status, \
                 COALESCE(t.priority, ''), COALESCE(t.due, ''), \
                 COALESCE(t.dod, ''), COALESCE(t.promised_to, ''), \
                 COALESCE(t.time_estimate, ''), COALESCE(t.tracker_url, '') \
                 FROM tasks t LEFT JOIN projects p ON t.project_id = p.id WHERE t.id = ?1",
                [fid],
                |row| {
                    Ok(format!(
                        "id: {}\ntitle: {}\nproject: {}\nstatus: {}\npriority: {}\ndue: {}\ndod: {}\npromised_to: {}\nestimate: {}\ntracker_url: {}",
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, String>(7)?,
                        row.get::<_, String>(8)?,
                        row.get::<_, String>(9)?,
                    ))
                },
            ).ok()
        }).unwrap_or_default();

        (cfg, memory, focused_task_context)
    };

    let hist = history.unwrap_or_default();

    let reporter = {
        let app = app.clone();
        agent::ProgressReporter::new(run_id.clone(), move |step| {
            let _ = app.emit("agent-progress", step);
        })
    };
    let cancelled = agent::register_run(&run_id);

    // Three ways out, and every one of them settles the promise the UI is
    // waiting on: the answer, the user pressing stop, or a panic that would
    // otherwise kill this task and hang the panel forever.
    let outcome = tokio::select! {
        finished = AssertUnwindSafe(agent::chat(
            &cfg, &message, &hist,
            &memory, &focused_task_context,
            &db.0, &reporter,
        )).catch_unwind() => finished.unwrap_or_else(|_| {
            logger::log("error", "[agent_chat] aborted by a panic (see the [panic] entry above)");
            Err("INTERNAL_ERROR".to_string())
        }),
        _ = cancelled.notified() => {
            logger::log("info", &format!("[agent_chat] run {} stopped by the user", run_id));
            Err(agent::CANCELLED.to_string())
        }
    };
    agent::finish_run(&run_id);
    let result = outcome?;

    crate::services::logger::log("info", &format!("[agent_chat] done: {} tool calls, {} pending, text len: {}",
        result.tool_calls.len(), result.pending_confirmations.len(), result.text.len()));
    Ok(result)
}

#[derive(serde::Serialize)]
pub struct LlmTestResult {
    pub provider: String,
    pub model: String,
    pub latency_ms: u64,
    /// Names of the tools the model actually called during the probe.
    pub tools_called: Vec<String>,
    /// What the model replied with once it had the tool result.
    pub answer: String,
    /// Projects the probe tool really returned, so the answer can be sanity-checked.
    pub projects_in_db: usize,
}

/// What the settings screen can offer.
///
/// The list lives in the service next to the code that calls these services, so
/// teaching the app a new provider is one row there and nothing here.
#[tauri::command]
pub fn llm_providers() -> &'static [crate::services::llm::Provider] {
    crate::services::llm::PROVIDERS
}

/// Probe the configured LLM through the same tool-use loop the rest of the app
/// uses, so the test fails exactly where the real features would fail.
#[tauri::command]
pub async fn test_llm_connection(db: State<'_, DbState>) -> Result<LlmTestResult, String> {
    let (cfg, projects_in_db) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;

        let cfg = crate::services::llm::LlmConfig::read(&conn)?;

        let projects_in_db: i64 = conn
            .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
            .unwrap_or(0);

        (cfg, projects_in_db as usize)
    };

    let system = "You are a connection self-test. You MUST call the list_projects tool \
                  before answering — never answer from memory. After the tool returns, \
                  reply with one short line: the number of projects and their names.";
    let user = "How many projects are there? Call the tool first.";

    logger::log(
        "info",
        &format!("[llm-test] probing provider={} model={}", cfg.provider_id, cfg.model),
    );

    let started = std::time::Instant::now();
    let (answer, trace) = agent::run_tool_loop_traced(
        &cfg,
        system,
        user,
        &["list_projects"],
        &db.0,
    )
    .await?;
    let latency_ms = started.elapsed().as_millis() as u64;

    let tools_called: Vec<String> = trace.into_iter().map(|c| c.tool_name).collect();
    logger::log(
        "info",
        &format!(
            "[llm-test] done in {}ms, tools: {:?}, answer len {}",
            latency_ms,
            tools_called,
            answer.len()
        ),
    );

    Ok(LlmTestResult {
        provider: cfg.provider_id,
        model: cfg.model,
        latency_ms,
        tools_called,
        answer: answer.trim().to_string(),
        projects_in_db,
    })
}

/// Stop a running [`agent_chat`]. Returns whether that run was still live.
#[tauri::command]
pub fn agent_cancel(run_id: String) -> bool {
    let was_running = agent::cancel_run(&run_id);
    logger::log(
        "info",
        &format!("[agent] stop requested for run {} (running: {})", run_id, was_running),
    );
    was_running
}

/// Execute confirmed dangerous tools
#[tauri::command]
pub async fn agent_confirm(
    db: State<'_, DbState>,
    tool_calls: Vec<agent::PendingToolCall>,
) -> Result<Vec<agent::ToolCallLog>, String> {
    let mut results = Vec::new();
    for tc in &tool_calls {
        let result = agent::execute_confirmed_tool(&tc.tool_name, &tc.arguments, &db.0).await;
        crate::services::logger::log("info", &format!("[agent] confirmed tool {} -> {}", tc.tool_name, crate::services::logger::snippet(&result, 200)));
        results.push(agent::ToolCallLog {
            tool_name: tc.tool_name.clone(),
            arguments: tc.arguments.clone(),
            result,
        });
    }
    Ok(results)
}
