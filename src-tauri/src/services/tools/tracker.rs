//! Yandex Tracker, as tools.
//!
//! These are the only tools that leave the machine, so they are kept apart: the
//! registry hands them the token and organisation, and they never touch the
//! database directly.

use serde_json::{json, Value};
use std::future::Future;
use std::pin::Pin;

use super::{Availability, Danger, Handler, Tool};
use crate::services::tracker as api;

type Answer = Pin<Box<dyn Future<Output = String> + Send>>;

fn read_issue(token: String, org_id: String, args: Value) -> Answer {
    Box::pin(async move {
        let raw = args["issue_key"].as_str().unwrap_or("");
        let key = api::extract_issue_key(raw).unwrap_or_else(|| raw.to_string());
        match api::fetch_issue(&token, &org_id, &key).await {
            Ok(issue) => issue.to_context_string(),
            Err(e) => format!("Error reading tracker issue: {}", e),
        }
    })
}

fn search_issues(token: String, org_id: String, args: Value) -> Answer {
    Box::pin(async move {
        let text = args["text"].as_str().unwrap_or("");
        let queue = args["queue"].as_str().map(str::to_string);
        match api::search_issues(&token, &org_id, text, queue.as_deref(), 10).await {
            Ok(issues) if issues.is_empty() => format!("No tracker issues found for \"{}\"", text),
            Ok(issues) => issues
                .iter()
                .map(|i| {
                    format!(
                        "- {} | {} | {} | updated {}\n  https://tracker.yandex.ru/{}",
                        i.key, i.summary, i.status, i.updated_at, i.key
                    )
                })
                .collect::<Vec<_>>()
                .join("\n"),
            Err(e) => format!("Error searching tracker: {}", e),
        }
    })
}

fn create_issue(token: String, org_id: String, args: Value) -> Answer {
    Box::pin(async move {
        let queue = args["queue"].as_str().unwrap_or("").to_string();
        let summary = args["summary"].as_str().unwrap_or("").to_string();
        let description = args["description"].as_str().map(str::to_string);
        let priority = args["priority"].as_str().map(str::to_string);
        match api::create_issue(
            &token,
            &org_id,
            &queue,
            &summary,
            description.as_deref(),
            priority.as_deref(),
        )
        .await
        {
            Ok(issue) => format!(
                "Created tracker issue: {} — {}\nhttps://tracker.yandex.ru/{}",
                issue.key, issue.summary, issue.key
            ),
            Err(e) => format!("Error creating tracker issue: {}", e),
        }
    })
}

pub fn tools() -> Vec<Tool> {
    vec![
        Tool {
            name: "read_tracker_issue",
            summary: "Read a Yandex Tracker issue by key (e.g. QUEUE-123) or URL",
            keywords: &["трекер", "тикет", "tracker", "issue", "ticket"],
            availability: Availability::OnDemand,
            danger: Danger::Safe,
            params: || {
                json!({
                    "type": "object",
                    "properties": { "issue_key": { "type": "string", "description": "Issue key like QUEUE-123 or full tracker URL" } },
                    "required": ["issue_key"]
                })
            },
            handler: Handler::Tracker(read_issue),
        },
        Tool {
            name: "search_tracker_issues",
            summary: "Find Yandex Tracker issues whose title contains the given text, newest first. Use this to locate the ticket behind a task instead of guessing issue keys; then link it with update_task(tracker_url).",
            keywords: &[
                "трекер", "найти тикет", "поиск в трекере", "прилинковать", "привязать",
                "tracker", "search issue", "find ticket", "link ticket",
            ],
            availability: Availability::OnDemand,
            danger: Danger::Safe,
            params: || {
                json!({
                    "type": "object",
                    "properties": {
                        "text": { "type": "string", "description": "Words from the issue title, e.g. the task's own title" },
                        "queue": { "type": "string", "description": "Limit to one queue, e.g. RAGSERVIS (optional)" },
                    },
                    "required": ["text"]
                })
            },
            handler: Handler::Tracker(search_issues),
        },
        Tool {
            name: "create_tracker_issue",
            summary: "Create a new issue in Yandex Tracker",
            keywords: &["трекер", "завести тикет", "create issue", "tracker"],
            availability: Availability::OnDemand,
            danger: Danger::Confirm,
            params: || {
                json!({
                    "type": "object",
                    "properties": {
                        "queue": { "type": "string", "description": "Queue key, e.g. MYPROJECT" },
                        "summary": { "type": "string", "description": "Issue title" },
                        "description": { "type": "string", "description": "Issue description" },
                        "priority": { "type": "string", "enum": ["p0","p1","p2","p3"], "description": "Priority mapping: p0=critical, p1=high, p2=normal, p3=low" },
                    },
                    "required": ["queue", "summary"]
                })
            },
            handler: Handler::Tracker(create_issue),
        },
    ]
}
