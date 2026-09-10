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
    /// What the ticket says the work should take.
    pub estimate: String,
    /// What has been logged against it so far.
    pub spent: String,
    /// The date it is due, if the ticket carries one.
    pub deadline: String,
    /// Task, Story, Bug — the ticket's own type.
    pub issue_type: String,
}

impl TrackerIssue {
    pub fn to_context_string(&self) -> String {
        format!(
            "## Linked Tracker Issue: {key}\n\
             - **Summary**: {summary}\n\
             - **Status**: {status}\n\
             - **Type**: {issue_type}\n\
             - **Assignee**: {assignee}\n\
             - **Priority**: {priority}\n\
             - **Estimate**: {estimate}\n\
             - **Time spent**: {spent}\n\
             - **Deadline**: {deadline}\n\
             {desc}",
            key = self.key,
            summary = self.summary,
            status = self.status,
            issue_type = or_dash(&self.issue_type),
            assignee = self.assignee,
            priority = self.priority,
            estimate = or_dash(&self.estimate),
            spent = or_dash(&self.spent),
            deadline = or_dash(&self.deadline),
            desc = if self.description.is_empty() {
                String::new()
            } else {
                format!("\n### Description\n{}\n", self.description)
            },
        )
    }
}

fn or_dash(value: &str) -> &str {
    if value.is_empty() {
        "—"
    } else {
        value
    }
}

/// Turn a tracker duration into the words the app uses.
///
/// The API answers in ISO-8601 (`P1DT1H45M`, `PT0S`, `P2W`), which is unreadable
/// in a task panel and useless to a model asked to "estimate like the ticket
/// does". Zero comes back empty rather than as "0с": a ticket with no estimate
/// should read as having none, not as taking no time.
pub fn humanize_duration(iso: &str) -> String {
    let Some(rest) = iso.trim().strip_prefix('P') else {
        return String::new();
    };

    let (date_part, time_part) = match rest.split_once('T') {
        Some((date, time)) => (date, time),
        None => (rest, ""),
    };

    let mut parts = Vec::new();
    let mut collect = |section: &str, units: &[(char, &str)]| {
        let mut number = String::new();
        for ch in section.chars() {
            if ch.is_ascii_digit() {
                number.push(ch);
                continue;
            }
            if let Some((_, label)) = units.iter().find(|(unit, _)| *unit == ch) {
                if !number.is_empty() && number != "0" {
                    parts.push(format!("{}{}", number, label));
                }
            }
            number.clear();
        }
    };

    collect(date_part, &[('W', "н"), ('D', "д")]);
    collect(time_part, &[('H', "ч"), ('M', "м"), ('S', "с")]);

    parts.join(" ")
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
/// Is this whole string nothing but tracker references — a link, an issue key,
/// or several of them — with no words of its own?
///
/// Used to tell a placeholder title ("https://tracker.yandex.ru/QUEUE-1") from a
/// real one that merely mentions a ticket ("Оценить QUEUE-1 до пятницы"). The
/// match is deliberately stricter than [`extract_issue_key`], which accepts any
/// short hyphenated word and would happily read "Кэш-промт" as an issue key.
pub fn is_bare_issue_reference(text: &str) -> bool {
    let mut saw_one = false;
    for token in text.split_whitespace() {
        if !is_issue_reference(token) {
            return false;
        }
        saw_one = true;
    }
    saw_one
}

/// One token that can only be a tracker reference: an issue URL, or a `KEY-123`
/// code (uppercase Latin queue, digits after the dash).
fn is_issue_reference(token: &str) -> bool {
    let token = token.trim_matches(|c: char| c.is_ascii_punctuation() && c != '-' && c != '/' && c != ':');
    if token.contains("tracker.yandex.") {
        return extract_issue_key(token).is_some();
    }
    let Some((queue, number)) = token.split_once('-') else {
        return false;
    };
    !queue.is_empty()
        && queue.starts_with(|c: char| c.is_ascii_uppercase())
        && queue.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
        && !number.is_empty()
        && number.chars().all(|c| c.is_ascii_digit())
}

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

    // `estimation` is what the ticket promises and `originalEstimation` what it
    // promised first; when only the latter is filled in it is still the answer
    // to "how long is this supposed to take".
    let estimate = humanize_duration(json["estimation"].as_str().unwrap_or(""));
    let estimate = if estimate.is_empty() {
        humanize_duration(json["originalEstimation"].as_str().unwrap_or(""))
    } else {
        estimate
    };

    Ok(TrackerIssue {
        key: json["key"].as_str().unwrap_or("").to_string(),
        summary: json["summary"].as_str().unwrap_or("").to_string(),
        status: get_nested(&json, &["status", "display"]).unwrap_or("").to_string(),
        assignee: get_nested(&json, &["assignee", "display"]).unwrap_or("unassigned").to_string(),
        priority: get_nested(&json, &["priority", "display"]).unwrap_or("").to_string(),
        description: json["description"].as_str().unwrap_or("").to_string(),
        estimate,
        spent: humanize_duration(json["spent"].as_str().unwrap_or("")),
        // The API calls it `deadline`; `dueDate` is the older name and costs
        // nothing to keep as a fallback.
        deadline: json["deadline"]
            .as_str()
            .or_else(|| json["dueDate"].as_str())
            .unwrap_or("")
            .to_string(),
        issue_type: get_nested(&json, &["type", "display"]).unwrap_or("").to_string(),
    })
}

/// One line of a search result — enough to choose between issues without
/// fetching each one.
pub struct TrackerIssueBrief {
    pub key: String,
    pub summary: String,
    pub status: String,
    pub updated_at: String,
}

/// Find issues whose summary contains `text`, newest first.
///
/// Without this the only way to "find the ticket for this task" was to read
/// issues one by one by key, which is what the agent actually did: two dozen
/// reads, the iteration cap, and the wrong ticket linked. The query language's
/// `Summary: "text"` matches a substring; the looser `~` operator returns the
/// whole queue and was worse than useless here.
pub async fn search_issues(
    token: &str,
    org_id: &str,
    text: &str,
    queue: Option<&str>,
    limit: usize,
) -> Result<Vec<TrackerIssueBrief>, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("Search text is empty".to_string());
    }

    let mut query = String::new();
    if let Some(queue) = queue.map(str::trim).filter(|q| !q.is_empty()) {
        query.push_str(&format!("Queue: {} AND ", sanitize_queue(queue)));
    }
    query.push_str(&format!("Summary: \"{}\"", escape_query(text)));
    query.push_str(" \"Sort by\": Updated DESC");

    let client = Client::new();
    let resp = client
        .post(&format!("{}/issues/_search?perPage={}", API_BASE, limit.clamp(1, 50)))
        .header("Authorization", format!("OAuth {}", token))
        .header("X-Org-Id", org_id)
        .header("Content-Type", "application/json")
        .timeout(std::time::Duration::from_secs(15))
        .json(&serde_json::json!({ "query": query }))
        .send()
        .await
        .map_err(|e| format!("Tracker API error: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!(
            "Tracker API HTTP {}: {}",
            status,
            crate::services::logger::snippet(&body, 200)
        ));
    }

    let issues: Vec<Value> = resp
        .json()
        .await
        .map_err(|e| format!("Tracker parse error: {}", e))?;

    Ok(issues
        .iter()
        .map(|issue| TrackerIssueBrief {
            key: issue["key"].as_str().unwrap_or("").to_string(),
            summary: issue["summary"].as_str().unwrap_or("").to_string(),
            status: get_nested(issue, &["status", "display"]).unwrap_or("").to_string(),
            updated_at: issue["updatedAt"].as_str().unwrap_or("").chars().take(10).collect(),
        })
        .collect())
}

/// Keep the search text inside its quotes: a stray quote would change the
/// meaning of the query, and a newline would break it outright.
fn escape_query(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_control())
        .map(|c| match c {
            '"' => ' ',
            '\\' => ' ',
            other => other,
        })
        .collect::<String>()
        .trim()
        .to_string()
}

/// A queue key is uppercase letters and digits — anything else is not a queue.
fn sanitize_queue(queue: &str) -> String {
    queue
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
        .collect::<String>()
        .to_uppercase()
}

pub async fn create_issue(
    token: &str,
    org_id: &str,
    queue: &str,
    summary: &str,
    description: Option<&str>,
    priority: Option<&str>,
) -> Result<TrackerIssue, String> {
    let client = Client::new();
    let url = format!("{}/issues", API_BASE);

    let mut body = serde_json::json!({
        "queue": queue,
        "summary": summary,
    });

    if let Some(desc) = description {
        body["description"] = Value::String(desc.to_string());
    }
    if let Some(prio) = priority {
        // Yandex Tracker priorities: 1=blocker, 2=critical, 3=normal, 4=minor, 5=trivial
        let prio_id = match prio {
            "p0" | "critical" | "blocker" => "2",
            "p1" | "high" => "2",
            "p2" | "normal" | "medium" => "3",
            "p3" | "low" => "4",
            other => other,
        };
        body["priority"] = Value::String(prio_id.to_string());
    }

    let resp = client
        .post(&url)
        .header("Authorization", format!("OAuth {}", token))
        .header("X-Org-Id", org_id)
        .header("Content-Type", "application/json")
        .timeout(std::time::Duration::from_secs(15))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Tracker API error: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let err_body = resp.text().await.unwrap_or_default();
        return Err(format!("Tracker API HTTP {}: {}", status, err_body));
    }

    let json: Value = resp.json().await.map_err(|e| format!("Tracker parse error: {}", e))?;

    Ok(TrackerIssue {
        key: json["key"].as_str().unwrap_or("").to_string(),
        summary: json["summary"].as_str().unwrap_or("").to_string(),
        status: get_nested(&json, &["status", "display"]).unwrap_or("").to_string(),
        assignee: get_nested(&json, &["assignee", "display"]).unwrap_or("unassigned").to_string(),
        priority: get_nested(&json, &["priority", "display"]).unwrap_or("").to_string(),
        description: json["description"].as_str().unwrap_or("").to_string(),
        estimate: humanize_duration(json["estimation"].as_str().unwrap_or("")),
        spent: humanize_duration(json["spent"].as_str().unwrap_or("")),
        // The API calls it `deadline`; `dueDate` is the older name and costs
        // nothing to keep as a fallback.
        deadline: json["deadline"]
            .as_str()
            .or_else(|| json["dueDate"].as_str())
            .unwrap_or("")
            .to_string(),
        issue_type: get_nested(&json, &["type", "display"]).unwrap_or("").to_string(),
    })
}

/// Fetch all tracker issues referenced in task fields and return context string
pub async fn enrich_context(
    token: &str,
    org_id: &str,
    fields: &[Option<&str>],
) -> String {
    let all_text: String = fields
        .iter()
        .filter_map(|f| *f)
        .collect::<Vec<_>>()
        .join(" ");

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

#[cfg(test)]
mod duration_tests {
    use super::humanize_duration;

    #[test]
    fn reads_the_shapes_the_tracker_actually_sends() {
        assert_eq!(humanize_duration("P4D"), "4д");
        assert_eq!(humanize_duration("P1DT1H45M"), "1д 1ч 45м");
        assert_eq!(humanize_duration("PT1H30M"), "1ч 30м");
        assert_eq!(humanize_duration("P2WT3H45M"), "2н 3ч 45м");
    }

    #[test]
    fn no_estimate_reads_as_none_not_as_zero() {
        assert_eq!(humanize_duration("PT0S"), "");
        assert_eq!(humanize_duration("P0D"), "");
        assert_eq!(humanize_duration(""), "");
        assert_eq!(humanize_duration("nonsense"), "");
    }
}

#[cfg(test)]
mod bare_reference_tests {
    use super::is_bare_issue_reference;

    #[test]
    fn a_link_or_key_on_its_own_is_bare() {
        assert!(is_bare_issue_reference("https://tracker.yandex.ru/RAGSERVIS-226"));
        assert!(is_bare_issue_reference("  RAGSERVIS-226  "));
        assert!(is_bare_issue_reference("RAGSERVIS-226 https://tracker.yandex.ru/FLEX-1"));
    }

    #[test]
    fn a_title_with_words_of_its_own_is_not() {
        assert!(!is_bare_issue_reference("Оценить RAGSERVIS-226"));
        assert!(!is_bare_issue_reference("RAGSERVIS-226 — оценка"));
        assert!(!is_bare_issue_reference(""));
        assert!(!is_bare_issue_reference("   "));
    }

    /// The trap the loose key parser falls into: ordinary hyphenated words.
    #[test]
    fn hyphenated_words_are_not_issue_keys() {
        assert!(!is_bare_issue_reference("Кэш-промт"));
        assert!(!is_bare_issue_reference("что-то"));
        assert!(!is_bare_issue_reference("e-mail"));
        assert!(!is_bare_issue_reference("UI-обзор"));
    }
}

#[cfg(test)]
mod search_tests {
    use super::{escape_query, sanitize_queue};

    #[test]
    fn search_text_cannot_break_out_of_its_quotes() {
        assert_eq!(escape_query("демо\" AND Queue: OTHER"), "демо  AND Queue: OTHER");
        assert_eq!(escape_query("две\nстроки"), "двестроки");
        assert_eq!(escape_query("  отчёт  "), "отчёт");
    }

    #[test]
    fn a_queue_key_is_only_a_queue_key() {
        assert_eq!(sanitize_queue("ragservis"), "RAGSERVIS");
        assert_eq!(sanitize_queue("RAG\" OR 1=1"), "RAGOR11");
    }
}
