use reqwest::Client;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use crate::services::tools;
use tokio::sync::Notify;

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

// ---- Live progress ----

/// One step of a run, pushed to the UI while the agent is still working.
///
/// Only the raw facts travel: the tool that is running and a short hint pulled
/// from its arguments. Wording and localisation belong to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct AgentProgress {
    pub run_id: String,
    /// Monotonic per run, so the UI can order and de-duplicate events.
    pub seq: usize,
    /// `thinking` — waiting on the model; `tool` — a tool is executing.
    pub phase: String,
    pub tool: Option<String>,
    /// Set when one tool name covers two user-visible actions (archive/restore).
    pub variant: Option<String>,
    /// Task title, issue key, search query — whatever names the step.
    pub detail: Option<String>,
}

type ProgressSink = dyn Fn(AgentProgress) + Send + Sync;

/// Sink for [`AgentProgress`] events, tagged with the run they belong to.
pub struct ProgressReporter {
    run_id: String,
    sink: Box<ProgressSink>,
    seq: AtomicUsize,
}

impl ProgressReporter {
    pub fn new(
        run_id: impl Into<String>,
        sink: impl Fn(AgentProgress) + Send + Sync + 'static,
    ) -> Self {
        Self { run_id: run_id.into(), sink: Box::new(sink), seq: AtomicUsize::new(0) }
    }

    fn emit(&self, phase: &str, tool: Option<&str>, variant: Option<&str>, detail: Option<String>) {
        (self.sink)(AgentProgress {
            run_id: self.run_id.clone(),
            seq: self.seq.fetch_add(1, Ordering::Relaxed),
            phase: phase.to_string(),
            tool: tool.map(str::to_string),
            variant: variant.map(str::to_string),
            detail,
        });
    }

    /// The model is composing its next move.
    pub fn thinking(&self) {
        self.emit("thinking", None, None, None);
    }

    /// A tool is about to run; `db` is only read to name it.
    pub fn tool(&self, name: &str, args: &Value, db: &Mutex<Connection>) {
        let (variant, detail) = progress_hint(name, args, db);
        self.emit("tool", Some(name), variant, detail);
    }
}

/// Longest hint shown on a progress line — more is noise in a 420px panel.
const HINT_MAX_BYTES: usize = 80;

/// Name a step from its arguments: the task's title, the issue key, the query.
fn progress_hint(
    name: &str,
    args: &Value,
    db: &Mutex<Connection>,
) -> (Option<&'static str>, Option<String>) {
    let arg = |key: &str| {
        args[key]
            .as_str()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_string)
    };
    let task_title = || {
        let id = args["task_id"].as_str()?;
        let conn = db.lock().ok()?;
        conn.query_row("SELECT title FROM tasks WHERE id = ?1", [id], |r| {
            r.get::<_, String>(0)
        })
        .ok()
    };

    let (variant, detail) = match name {
        "create_task" => (None, arg("title")),
        "update_task" | "move_task" | "delete_task" | "get_task" => (None, task_title()),
        "set_task_archived" => (
            if args["archived"].as_bool() == Some(false) { Some("restore") } else { None },
            task_title(),
        ),
        "search_tasks" => (None, arg("query")),
        "read_tracker_issue" => (
            None,
            arg("issue_key")
                .map(|k| crate::services::tracker::extract_issue_key(&k).unwrap_or(k)),
        ),
        "create_tracker_issue" => (None, arg("summary")),
        "remember" => (None, arg("fact")),
        _ => (None, None),
    };

    let detail = detail.map(|d| {
        let cut = crate::services::logger::snippet(&d, HINT_MAX_BYTES);
        if cut.len() < d.len() {
            format!("{}\u{2026}", cut.trim_end())
        } else {
            d
        }
    });
    (variant, detail)
}

// ---- Cancellation ----

/// Error text returned when the user stops a run; the UI matches on it and
/// stays quiet instead of reporting a failure.
pub const CANCELLED: &str = "AGENT_CANCELLED";

static ACTIVE_RUNS: OnceLock<Mutex<HashMap<String, Arc<Notify>>>> = OnceLock::new();

fn active_runs() -> &'static Mutex<HashMap<String, Arc<Notify>>> {
    ACTIVE_RUNS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Register a stoppable run. Await the returned signal alongside the work — it
/// fires when [`cancel_run`] is called with the same id.
pub fn register_run(run_id: &str) -> Arc<Notify> {
    let signal = Arc::new(Notify::new());
    if let Ok(mut runs) = active_runs().lock() {
        runs.insert(run_id.to_string(), signal.clone());
    }
    signal
}

/// Drop a finished run from the registry.
pub fn finish_run(run_id: &str) {
    if let Ok(mut runs) = active_runs().lock() {
        runs.remove(run_id);
    }
}

/// Stop a run. Returns whether it was still live.
pub fn cancel_run(run_id: &str) -> bool {
    let signal = active_runs().lock().ok().and_then(|mut runs| runs.remove(run_id));
    match signal {
        // `notify_one` leaves a permit behind, so a stop racing ahead of the
        // first await still lands.
        Some(signal) => {
            signal.notify_one();
            true
        }
        None => false,
    }
}

/// Execute a confirmed dangerous tool (called after user approves)
/// Execute a tool the user has confirmed.
pub async fn execute_confirmed_tool(tool_name: &str, args: &Value, db: &Mutex<Connection>) -> String {
    crate::services::tools::execute(tool_name, args, db).await
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

Your toolbox is larger than the tools listed above. Anything the user can do in the app, you can do too — projects and sub-projects, icons and colours, the theme and the language, the archive, the WIP limit, undo, the tracker, opening a screen or a task. When a request needs something that is not in your current tool list, call find_tools with a few words from the request (for example "цвет проекта", "theme", "archive", "undo") and the matching tools become available immediately. Never tell the user to do it by hand before you have looked.
{memory}
Rules:
- Use the same language as the user
- Use list_projects to see available projects; use list_tasks to see tasks (filter by project_id/status as needed)
- Use search_tasks to find a specific task by name
- When user mentions a tracker link, use read_tracker_issue to get details
- To find the ticket behind a task, call search_tracker_issues with words from its title, then attach the chosen one with update_task(tracker_url). Never guess issue keys or read them one by one
- When creating tasks, fill in as many fields as you can infer
- Stale tasks nobody plans to do belong in the archive (set_task_archived), not the trash — archived tasks are hidden from list_tasks/search_tasks but can be restored
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
        let msg = format!("[agent] API error {}: {}", status, crate::services::logger::snippet(&body, 300));
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

/// The tool that opens the rest of the catalogue.
const FIND_TOOLS: &str = "find_tools";

/// What the model may call on this turn: the tools it has been given so far,
/// plus the one that finds more.
fn definitions_for(exposed: &[String]) -> Vec<Value> {
    let mut defs: Vec<Value> = tools::registry()
        .iter()
        .filter(|t| exposed.iter().any(|name| name == t.name))
        .map(|t| t.definition())
        .collect();

    defs.push(json!({
        "name": FIND_TOOLS,
        "description": "Look up abilities that are not in this list yet — projects, appearance, settings, the archive, the tracker, anything the app itself can do. Call it with a few words from the request (\"цвет проекта\", \"theme\", \"archive\") and the matching tools become callable right away.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": { "type": "string", "description": "A few words describing what you need to do" }
            },
            "required": ["query"]
        }
    }));
    defs
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
    progress: &ProgressReporter,
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

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let is_anthropic = provider != "openrouter";

    // The model starts with the handful of tools nearly every request needs,
    // plus the one that finds the rest. Anything it discovers is added here and
    // stays for the remainder of the conversation, so a small model never has
    // to read the whole catalogue to do one thing.
    let mut exposed: Vec<String> = tools::core().iter().map(|t| t.name.to_string()).collect();

    // Build conversation messages
    let mut messages: Vec<Value> = Vec::new();
    for (role, content) in history {
        messages.push(json!({"role": role, "content": content}));
    }
    messages.push(json!({"role": "user", "content": user_message}));

    let mut all_tool_calls: Vec<ToolCallLog> = Vec::new();
    // Enough headroom for a bulk request — "move every task about X into project
    // Y" is one search plus a run of updates — without letting a confused model
    // loop forever. The user can stop a run at any point anyway.
    let max_iterations = 16;

    for iteration in 0..max_iterations {
        crate::services::logger::log("info", &format!("[agent] iteration {}, messages: {}", iteration, messages.len()));
        progress.thinking();

        let tool_defs = definitions_for(&exposed);
        let formatted_tools = if is_anthropic {
            tools_for_anthropic(&tool_defs)
        } else {
            tools_for_openai(&tool_defs)
        };

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
            if tools::is_dangerous(name) {
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
            } else if name == FIND_TOOLS {
                let query = args["query"].as_str().unwrap_or("");
                let found = tools::find(query, 6);
                for tool in &found {
                    if !exposed.iter().any(|n| n == tool.name) {
                        exposed.push(tool.name.to_string());
                    }
                }
                let result = if found.is_empty() {
                    format!("No tools match \"{}\". Try other words.", query)
                } else {
                    format!(
                        "These tools are now available to call directly:\n{}",
                        found
                            .iter()
                            .map(|t| format!("- {}: {}", t.name, t.summary))
                            .collect::<Vec<_>>()
                            .join("\n")
                    )
                };
                crate::services::logger::log(
                    "info",
                    &format!("[agent] find_tools({}) -> {} tools", query, found.len()),
                );
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
            } else {
                // Safe — execute immediately
                progress.tool(name, args, db);
                let result = tools::execute(name, args, db).await;

                crate::services::logger::log("info", &format!("[agent] tool {}({}) -> {}", name, args, crate::services::logger::snippet(&result, 200)));

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

/// Run a self-contained tool-use loop with a restricted, read-only toolset and
/// return the model's final text answer. Used by structured-output features
/// (e.g. AI fill) that need the agent to gather context via tools but must not
/// expose mutating tools. `allowed_tools` is intersected with the safe (non-
/// dangerous) tool set, so it can never execute confirmation-gated actions.
pub async fn run_tool_loop(
    provider: &str,
    api_key: &str,
    model: &str,
    system: &str,
    user_message: &str,
    allowed_tools: &[&str],
    db: &Mutex<Connection>,
) -> Result<String, String> {
    run_tool_loop_traced(provider, api_key, model, system, user_message, allowed_tools, db)
        .await
        .map(|(text, _)| text)
}

/// Same loop as [`run_tool_loop`], but also returns every tool call it made.
/// Used by the connection test, which has to prove tool use actually happened.
pub async fn run_tool_loop_traced(
    provider: &str,
    api_key: &str,
    model: &str,
    system: &str,
    user_message: &str,
    allowed_tools: &[&str],
    db: &Mutex<Connection>,
) -> Result<(String, Vec<ToolCallLog>), String> {
    let tool_defs: Vec<Value> = tools::registry()
        .iter()
        .filter(|t| allowed_tools.contains(&t.name) && t.danger != tools::Danger::Confirm)
        .map(|t| t.definition())
        .collect();

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let is_anthropic = provider != "openrouter";
    let formatted_tools = if is_anthropic { tools_for_anthropic(&tool_defs) } else { tools_for_openai(&tool_defs) };

    let mut messages: Vec<Value> = vec![json!({"role": "user", "content": user_message})];
    let mut trace: Vec<ToolCallLog> = Vec::new();
    let max_iterations = 8;

    for iteration in 0..max_iterations {
        crate::services::logger::log("info", &format!("[agent:loop] iteration {}, messages: {}", iteration, messages.len()));

        let (text, tool_calls, _stop) = if is_anthropic {
            call_anthropic(&client, api_key, model, system, &messages, &formatted_tools).await?
        } else {
            call_openai(&client, api_key, model, system, &messages, &formatted_tools).await?
        };

        // No tool calls — this is the final answer
        if tool_calls.is_empty() {
            return Ok((text.unwrap_or_default(), trace));
        }

        // Append the assistant message carrying the tool calls
        if is_anthropic {
            let mut content_blocks: Vec<Value> = Vec::new();
            if let Some(t) = &text {
                content_blocks.push(json!({"type": "text", "text": t}));
            }
            for (id, name, input) in &tool_calls {
                content_blocks.push(json!({"type": "tool_use", "id": id, "name": name, "input": input}));
            }
            messages.push(json!({"role": "assistant", "content": content_blocks}));
        } else {
            let tc_array: Vec<Value> = tool_calls.iter().map(|(id, name, args)| {
                json!({
                    "id": id, "type": "function",
                    "function": {"name": name, "arguments": serde_json::to_string(args).unwrap_or_default()}
                })
            }).collect();
            messages.push(json!({"role": "assistant", "content": text, "tool_calls": tc_array}));
        }

        // Execute every call — the allowlist guarantees they are safe reads
        let mut anthropic_results: Vec<Value> = Vec::new();
        for (id, name, args) in &tool_calls {
            let result = tools::execute(name, args, db).await;
            crate::services::logger::log("info", &format!("[agent:loop] tool {}({}) -> {}", name, args, crate::services::logger::snippet(&result, 200)));
            trace.push(ToolCallLog {
                tool_name: name.clone(),
                arguments: args.clone(),
                result: result.clone(),
            });
            if is_anthropic {
                anthropic_results.push(json!({"type": "tool_result", "tool_use_id": id, "content": result}));
            } else {
                messages.push(json!({"role": "tool", "tool_call_id": id, "content": result}));
            }
        }
        if is_anthropic && !anthropic_results.is_empty() {
            messages.push(json!({"role": "user", "content": anthropic_results}));
        }
    }

    // Iteration cap hit — one final call and take whatever text comes back
    let (text, _, _) = if is_anthropic {
        call_anthropic(&client, api_key, model, system, &messages, &formatted_tools).await?
    } else {
        call_openai(&client, api_key, model, system, &messages, &formatted_tools).await?
    };
    Ok((text.unwrap_or_default(), trace))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The model must always be able to reach the rest of the catalogue, and
    /// must not be handed the catalogue itself.
    #[test]
    fn the_first_turn_offers_the_core_tools_and_a_way_to_find_the_others() {
        let exposed: Vec<String> = tools::core().iter().map(|t| t.name.to_string()).collect();
        let defs = definitions_for(&exposed);
        let names: Vec<&str> = defs.iter().filter_map(|d| d["name"].as_str()).collect();

        assert!(names.contains(&FIND_TOOLS), "find_tools must always be offered");
        assert!(names.contains(&"list_tasks"));
        assert_eq!(names.len(), exposed.len() + 1, "only the core tools plus find_tools");

        // Everything else stays out of the prompt until it is asked for.
        assert!(!names.contains(&"set_appearance"));
        assert!(!names.contains(&"delete_project"));
    }

    /// What the loop does when the model calls find_tools: those tools become
    /// callable, with their real schemas.
    #[test]
    fn a_found_tool_becomes_callable() {
        let mut exposed: Vec<String> = tools::core().iter().map(|t| t.name.to_string()).collect();
        for tool in tools::find("поменяй тему оформления", 6) {
            exposed.push(tool.name.to_string());
        }
        let names: Vec<String> = definitions_for(&exposed)
            .iter()
            .filter_map(|d| d["name"].as_str().map(str::to_string))
            .collect();
        assert!(names.iter().any(|n| n == "set_appearance"));
    }

    #[test]
    fn cancel_reports_whether_the_run_was_live() {
        let id = "test-run-cancel";
        let _signal = register_run(id);
        assert!(cancel_run(id), "a registered run must report as stopped");
        assert!(!cancel_run(id), "a run can only be stopped once");
        assert!(!cancel_run("never-registered"));
    }

    #[tokio::test]
    async fn cancel_wakes_a_waiter_even_if_it_arrives_first() {
        let id = "test-run-race";
        let signal = register_run(id);
        // Stop lands before anyone awaits - the permit must survive.
        assert!(cancel_run(id));
        tokio::time::timeout(std::time::Duration::from_secs(1), signal.notified())
            .await
            .expect("notified() must return immediately on a stored permit");
    }

    #[test]
    fn finish_run_leaves_nothing_to_cancel() {
        let id = "test-run-finish";
        let _signal = register_run(id);
        finish_run(id);
        assert!(!cancel_run(id));
    }
}
