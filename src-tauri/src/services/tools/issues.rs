//! Issues, whichever tracker they live in.
//!
//! One set of tools for Yandex Tracker and GitLab: a person who has only one of
//! them should never read a tool description about the other, and a person with
//! both should not have to say which one a link belongs to. The provider is
//! decided from the link itself in [`crate::services::issues`].

use rusqlite::Connection;
use serde_json::{json, Value};
use std::future::Future;
use std::pin::Pin;
use std::sync::Mutex;

use super::{Availability, Danger, Handler, Tool};
use crate::services::issues::{self, Credentials, Provider};

type Answer<'a> = Pin<Box<dyn Future<Output = String> + Send + 'a>>;

fn read_issue<'a>(db: &'a Mutex<Connection>, args: Value) -> Answer<'a> {
    Box::pin(async move {
        let link = args["issue"].as_str().unwrap_or("").trim().to_string();
        match issues::read(db, &link).await {
            Ok(issue) => issue.to_context_string(),
            Err(e) => e,
        }
    })
}

fn search_issues<'a>(db: &'a Mutex<Connection>, args: Value) -> Answer<'a> {
    Box::pin(async move {
        let text = args["text"].as_str().unwrap_or("").to_string();
        match issues::search(db, &text, 10).await {
            Ok(found) if found.is_empty() => format!("No issues found for \"{}\"", text),
            Ok(found) => found
                .iter()
                .map(|issue| issue.to_line())
                .collect::<Vec<_>>()
                .join("\n"),
            Err(e) => e,
        }
    })
}

fn create_issue<'a>(db: &'a Mutex<Connection>, args: Value) -> Answer<'a> {
    Box::pin(async move {
        let credentials = Credentials::read(db);
        let queue = args["queue"].as_str().map(str::to_string);
        let project = args["project"].as_str().map(str::to_string);
        let summary = args["summary"].as_str().unwrap_or("").to_string();
        let description = args["description"].as_str().map(str::to_string);
        let priority = args["priority"].as_str().map(str::to_string);

        // Where the issue goes is the one thing that cannot be guessed: a queue
        // key belongs to Tracker, a project path to GitLab.
        let target = match (&queue, &project) {
            (Some(_), Some(_)) => {
                return "Give either a tracker queue or a GitLab project, not both".to_string()
            }
            (Some(_), None) => Some(Provider::YandexTracker),
            (None, Some(_)) => Some(Provider::GitLab),
            (None, None) => None,
        };

        match target {
            Some(Provider::YandexTracker) => match &credentials.tracker {
                Some((token, org_id)) => {
                    match crate::services::tracker::create_issue(
                        token,
                        org_id,
                        queue.as_deref().unwrap_or(""),
                        &summary,
                        description.as_deref(),
                        priority.as_deref(),
                    )
                    .await
                    {
                        Ok(issue) => format!("Created {} — {}\n{}", issue.key, issue.title, issue.url),
                        Err(e) => format!("Error creating the issue: {}", e),
                    }
                }
                None => "Yandex Tracker is not configured. Settings → Integrations.".to_string(),
            },
            Some(Provider::GitLab) => match &credentials.gitlab {
                Some((base_url, token)) => {
                    match crate::services::gitlab::create_issue(
                        base_url,
                        token,
                        project.as_deref().unwrap_or(""),
                        &summary,
                        description.as_deref(),
                    )
                    .await
                    {
                        Ok(issue) => format!("Created {} — {}\n{}", issue.key, issue.title, issue.url),
                        Err(e) => format!("Error creating the issue: {}", e),
                    }
                }
                None => "GitLab is not configured. Settings → Integrations.".to_string(),
            },
            None => "Say where to create it: a tracker queue (queue) or a GitLab project path (project)".to_string(),
        }
    })
}

pub fn tools() -> Vec<Tool> {
    vec![
        Tool {
            name: "read_issue",
            summary: "Read an issue from the user's tracker — a Yandex Tracker key or link (QUEUE-123), or a GitLab issue link or group/project#42 reference",
            keywords: &[
                "трекер", "тикет", "задача в трекере", "гитлаб", "issue",
                "tracker", "ticket", "gitlab", "read issue",
            ],
            availability: Availability::OnDemand,
            danger: Danger::Safe,
            params: || {
                json!({
                    "type": "object",
                    "properties": {
                        "issue": { "type": "string", "description": "QUEUE-123, group/project#42, or a full link to either" }
                    },
                    "required": ["issue"]
                })
            },
            handler: Handler::Net(read_issue),
        },
        Tool {
            name: "search_issues",
            summary: "Find issues by words from their title, across every tracker the user has connected (Yandex Tracker, GitLab). Use it to locate the issue behind a task instead of guessing keys, then attach it with update_task(tracker_url).",
            keywords: &[
                "найти тикет", "найди задачу", "поиск", "поиск в трекере", "прилинковать",
                "привязать", "гитлаб",
                "find ticket", "search issue", "tracker", "gitlab", "link issue",
            ],
            availability: Availability::OnDemand,
            danger: Danger::Safe,
            params: || {
                json!({
                    "type": "object",
                    "properties": {
                        "text": { "type": "string", "description": "Words from the issue title, e.g. the task's own title" }
                    },
                    "required": ["text"]
                })
            },
            handler: Handler::Net(search_issues),
        },
        Tool {
            name: "create_issue",
            summary: "Create an issue in the user's tracker: pass queue for Yandex Tracker or project for GitLab",
            keywords: &[
                "завести тикет", "создать задачу в трекере", "гитлаб",
                "create issue", "new ticket", "tracker", "gitlab",
            ],
            availability: Availability::OnDemand,
            danger: Danger::Confirm,
            params: || {
                json!({
                    "type": "object",
                    "properties": {
                        "summary": { "type": "string", "description": "Issue title" },
                        "description": { "type": "string" },
                        "queue": { "type": "string", "description": "Yandex Tracker queue key, e.g. MYPROJECT" },
                        "project": { "type": "string", "description": "GitLab project path, e.g. group/project" },
                        "priority": { "type": "string", "enum": ["p0","p1","p2","p3"], "description": "Yandex Tracker only: p0=critical … p3=low" },
                    },
                    "required": ["summary"]
                })
            },
            handler: Handler::Net(create_issue),
        },
    ]
}
