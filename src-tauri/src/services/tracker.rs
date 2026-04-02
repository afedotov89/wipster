use reqwest::Client;
use serde_json::Value;

const API_BASE: &str = "https://api.tracker.yandex.net/v2";

pub struct TrackerIssue {
    pub key: String,
    pub summary: String,
    pub status: String,
    pub assignee: String,
    pub priority: String,
    pub description: String,
}

impl TrackerIssue {
    pub fn to_context_string(&self) -> String {
        format!(
            "## Linked Tracker Issue: {key}\n\
             - **Summary**: {summary}\n\
             - **Status**: {status}\n\
             - **Assignee**: {assignee}\n\
             - **Priority**: {priority}\n\
             {desc}",
            key = self.key,
            summary = self.summary,
            status = self.status,
            assignee = self.assignee,
            priority = self.priority,
            desc = if self.description.is_empty() {
                String::new()
            } else {
                format!("\n### Description\n{}\n", self.description)
            },
        )
    }
}

fn get_nested<'a>(val: &'a Value, keys: &[&str]) -> Option<&'a str> {
    let mut current = val;
    for key in keys {
        current = current.get(key)?;
    }
    current.as_str()
}

/// Extract issue key from a tracker URL or key string
pub fn extract_issue_key(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Try as URL
    if trimmed.contains("tracker.yandex.ru") || trimmed.contains("tracker.yandex.com") {
        let path = trimmed.rsplit('/').next()?;
        let key = path.trim().to_uppercase();
        if key.contains('-') {
            return Some(key);
        }
    }

    // Try as plain key (e.g. "QUEUE-123")
    if trimmed.contains('-') && trimmed.len() < 30 {
        let upper = trimmed.to_uppercase();
        if upper.chars().all(|c| c.is_alphanumeric() || c == '-') {
            return Some(upper);
        }
    }

    None
}

/// Find all tracker issue keys/URLs in a text
pub fn find_tracker_refs(text: &str) -> Vec<String> {
    let mut keys = Vec::new();

    // Find URLs
    for word in text.split_whitespace() {
        if word.contains("tracker.yandex.") {
            if let Some(key) = extract_issue_key(word) {
                if !keys.contains(&key) {
                    keys.push(key);
                }
            }
        }
    }

    // Find bare keys like QUEUE-123
    let re_pattern = regex_lite::Regex::new(r"\b([A-ZА-Я][A-ZА-Я0-9]+-\d+)\b").ok();
    if let Some(re) = re_pattern {
        for cap in re.captures_iter(text) {
            if let Some(m) = cap.get(1) {
                let key = m.as_str().to_string();
                if !keys.contains(&key) {
                    keys.push(key);
                }
            }
        }
    }

    keys
}

pub async fn fetch_issue(token: &str, org_id: &str, issue_key: &str) -> Result<TrackerIssue, String> {
    let client = Client::new();
    let url = format!("{}/issues/{}", API_BASE, issue_key);

    let resp = client
        .get(&url)
        .header("Authorization", format!("OAuth {}", token))
        .header("X-Org-Id", org_id)
        .header("Content-Type", "application/json")
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Tracker API error: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Tracker API HTTP {}", resp.status()));
    }

    let json: Value = resp.json().await.map_err(|e| format!("Tracker parse error: {}", e))?;

    Ok(TrackerIssue {
        key: json["key"].as_str().unwrap_or("").to_string(),
        summary: json["summary"].as_str().unwrap_or("").to_string(),
        status: get_nested(&json, &["status", "display"]).unwrap_or("").to_string(),
        assignee: get_nested(&json, &["assignee", "display"]).unwrap_or("unassigned").to_string(),
        priority: get_nested(&json, &["priority", "display"]).unwrap_or("").to_string(),
        description: json["description"].as_str().unwrap_or("").to_string(),
    })
}

/// Fetch all tracker issues referenced in task fields and return context string
pub async fn enrich_context(
    token: &str,
    org_id: &str,
    task_title: &str,
    task_dod: Option<&str>,
    task_next_step: Option<&str>,
) -> String {
    let mut all_text = task_title.to_string();
    if let Some(dod) = task_dod {
        all_text.push(' ');
        all_text.push_str(dod);
    }
    if let Some(ns) = task_next_step {
        all_text.push(' ');
        all_text.push_str(ns);
    }

    let keys = find_tracker_refs(&all_text);
    if keys.is_empty() {
        return String::new();
    }

    let mut context_parts = Vec::new();
    for key in keys.iter().take(3) {
        match fetch_issue(token, org_id, key).await {
            Ok(issue) => context_parts.push(issue.to_context_string()),
            Err(e) => {
                eprintln!("[tracker] Failed to fetch {}: {}", key, e);
            }
        }
    }

    context_parts.join("\n")
}
