use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::models::project::Project;
use crate::models::task::Task;

// ---- Anthropic ----

#[derive(Debug, Serialize)]
struct AnthropicRequest {
    model: String,
    max_tokens: u32,
    system: String,
    messages: Vec<ChatMessage>,
}

#[derive(Debug, Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicContent>,
}

#[derive(Debug, Deserialize)]
struct AnthropicContent {
    text: Option<String>,
}

// ---- OpenRouter / OpenAI-compatible ----

#[derive(Debug, Serialize)]
struct OpenAIRequest {
    model: String,
    max_tokens: u32,
    messages: Vec<ChatMessage>,
}

#[derive(Debug, Deserialize)]
struct OpenAIResponse {
    choices: Vec<OpenAIChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenAIChoice {
    message: OpenAIMessage,
}

#[derive(Debug, Deserialize)]
struct OpenAIMessage {
    content: Option<String>,
}

// ---- Shared ----

#[derive(Debug, Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentAction {
    #[serde(alias = "type")]
    pub action: String,
    pub task_id: Option<String>,
    pub field: Option<String>,
    pub value: Option<String>,
    pub description: Option<String>,
    // Allow extra fields LLM might include
    pub project_id: Option<String>,
    pub priority: Option<String>,
    pub due: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentResponse {
    pub summary: String,
    pub actions: Vec<AgentAction>,
}

fn build_system_prompt(tasks: &[Task], projects: &[Project], memory: &str) -> String {
    let tasks_json: Vec<Value> = tasks
        .iter()
        .map(|t| {
            serde_json::json!({
                "id": t.id,
                "title": t.title,
                "status": t.status,
                "priority": t.priority,
                "due": t.due,
                "estimate": t.time_estimate,
                "project_id": t.project_id,
                "promised_to": t.promised_to,
                "dod": t.dod,
            })
        })
        .collect();

    let projects_json: Vec<Value> = projects
        .iter()
        .map(|p| serde_json::json!({"id": p.id, "name": p.name}))
        .collect();

    let memory_section = if memory.is_empty() {
        String::new()
    } else {
        format!("\nYour memory (facts you remembered about the user):\n{}\n", memory)
    };

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    format!(
        r#"You are Wipster's task management assistant. You help the user manage tasks via natural language.
Today's date: {today}
{memory_section}
Projects:
{projects}

Tasks:
{tasks}

You MUST respond with valid JSON only, no markdown. Format:
{{
  "summary": "What you'll do / your answer to the user",
  "actions": [...]
}}

Available actions:
- "update": update a task field. task_id required, field = "priority|due|estimate|time_estimate|title|dod|next_step|promised_to|checklist", value = new value.
- "delete": delete a task. task_id required.
- "move": change task status. task_id required, field="status", value = "queue|doing|done|inbox".
- "create": create a new task. All fields in ONE action object:
  {{
    "action": "create",
    "value": "task title",
    "project_id": "project id from list above (if clear from context)",
    "priority": "p0|p1|p2|p3 (if inferable)",
    "due": "YYYY-MM-DD (if mentioned or inferable)",
    "dod": "definition of done (if inferable from context)",
    "time_estimate": "e.g. 1ч, 2д (if inferable)",
    "promised_to": "person name (if mentioned)",
    "description": "human-readable summary of the created task"
  }}
  Fill as many fields as you can confidently infer from the conversation and context. Do NOT use separate update actions for fields you can set in create.
- "remember": save a fact to your memory. value = the fact to remember. Use when user shares personal info, preferences, or project context.
- "forget": remove a fact from memory. value = substring to match and remove.

Rules:
- When creating tasks, MAXIMIZE the fields you fill in. Infer priority from urgency words, due from time references, project from context, dod from the task nature.
- If user shares personal info (name, preferences), use "remember" to save it.
- If the request is unclear, return empty actions and explain in summary.
- Respond in the same language as the user's message.
- You can mix actions: e.g. remember + create + update in one response."#,
        memory_section = memory_section,
        projects = serde_json::to_string_pretty(&projects_json).unwrap_or_default(),
        tasks = serde_json::to_string_pretty(&tasks_json).unwrap_or_default(),
    )
}

fn parse_response(text: &str) -> Result<AgentResponse, String> {
    // Try to extract JSON if wrapped in markdown code block
    let cleaned = if let Some(start) = text.find('{') {
        let end = text.rfind('}').unwrap_or(text.len() - 1);
        &text[start..=end]
    } else {
        text
    };
    serde_json::from_str(cleaned)
        .map_err(|e| format!("Invalid agent response JSON: {}. Raw: {}", e, text))
}

pub async fn chat(
    provider: &str,
    api_key: &str,
    model: &str,
    user_message: &str,
    tasks: &[Task],
    projects: &[Project],
    memory: &str,
    focused_task_context: &str,
) -> Result<AgentResponse, String> {
    let mut system = build_system_prompt(tasks, projects, memory);
    if !focused_task_context.is_empty() {
        system.push_str(&format!("\n\n{}\nWhen user says \"this task\" or \"эта задача\" or similar, they mean the focused task above.", focused_task_context));
    }
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let text = match provider {
        "openrouter" => {
            let request = OpenAIRequest {
                model: model.to_string(),
                max_tokens: 16000,
                messages: vec![
                    ChatMessage { role: "system".to_string(), content: system },
                    ChatMessage { role: "user".to_string(), content: user_message.to_string() },
                ],
            };

            let response = client
                .post("https://openrouter.ai/api/v1/chat/completions")
                .header("Authorization", format!("Bearer {}", api_key))
                .header("content-type", "application/json")
                .json(&request)
                .send()
                .await
                .map_err(|e| format!("HTTP error: {}", e))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return Err(format!("API error {}: {}", status, body));
            }

            let api_response: OpenAIResponse = response
                .json()
                .await
                .map_err(|e| format!("Parse error: {}", e))?;

            api_response
                .choices
                .first()
                .and_then(|c| c.message.content.clone())
                .ok_or("Empty response from API")?
        }
        _ => {
            // Anthropic (default)
            let request = AnthropicRequest {
                model: model.to_string(),
                max_tokens: 16000,
                system,
                messages: vec![ChatMessage {
                    role: "user".to_string(),
                    content: user_message.to_string(),
                }],
            };

            let response = client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01")
                .header("content-type", "application/json")
                .json(&request)
                .send()
                .await
                .map_err(|e| format!("HTTP error: {}", e))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return Err(format!("API error {}: {}", status, body));
            }

            let api_response: AnthropicResponse = response
                .json()
                .await
                .map_err(|e| format!("Parse error: {}", e))?;

            api_response
                .content
                .first()
                .and_then(|c| c.text.clone())
                .ok_or("Empty response from API")?
        }
    };

    parse_response(&text)
}
