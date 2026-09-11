//! GitLab as a source of issues.
//!
//! For some people GitLab *is* the tracker — there is no Yandex Tracker in their
//! company at all — so this is a peer of [`crate::services::tracker`], not an
//! add-on to it. Everything here speaks the GitLab REST API v4 against whatever
//! host the user configured, which for a corporate install is their own.

use reqwest::Client;
use serde_json::Value;

use super::issues::{Issue, IssueBrief, Provider};

/// A GitLab issue, as the user refers to it.
#[derive(Debug, PartialEq)]
pub struct Reference {
    /// Project path, e.g. `group/subgroup/project`.
    pub project: String,
    /// Issue number within that project.
    pub iid: u64,
}

/// Read a GitLab reference out of a link or a `group/project#42` mention.
///
/// GitLab serves the same issue under `/-/issues/42` and, since work items,
/// `/-/work_items/42`; both have to resolve to the same thing or a link copied
/// from the browser would stop working depending on the day.
pub fn parse_reference(input: &str) -> Option<Reference> {
    let text = input.trim();

    if let Some(rest) = text.split("://").nth(1) {
        let path = rest.split_once('/')?.1;
        let (project, tail) = path.split_once("/-/")?;
        let number = tail
            .strip_prefix("issues/")
            .or_else(|| tail.strip_prefix("work_items/"))?;
        let iid = number
            .split(|c: char| !c.is_ascii_digit())
            .next()?
            .parse()
            .ok()?;
        return Some(Reference {
            project: project.trim_matches('/').to_string(),
            iid,
        });
    }

    // group/project#42
    let (project, number) = text.split_once('#')?;
    if !project.contains('/') {
        return None;
    }
    Some(Reference {
        project: project.trim().to_string(),
        iid: number.trim().parse().ok()?,
    })
}

/// GitLab's own wording for a duration ("4d 2h"), in the words this app uses.
pub fn humanize(human: &str) -> String {
    human
        .split_whitespace()
        .map(|part| {
            part.replace('w', "н")
                .replace('d', "д")
                .replace('h', "ч")
                .replace('m', "м")
                .replace('s', "с")
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn api(base_url: &str) -> String {
    format!("{}/api/v4", base_url.trim_end_matches('/'))
}

fn encode_project(path: &str) -> String {
    path.trim_matches('/').replace('/', "%2F")
}

/// Everything the app shows about one issue.
pub fn issue_from_json(json: &Value) -> Issue {
    let time = &json["time_stats"];
    let reference = json["references"]["full"]
        .as_str()
        .unwrap_or("")
        .to_string();

    Issue {
        provider: Provider::GitLab,
        key: if reference.is_empty() {
            format!("#{}", json["iid"].as_u64().unwrap_or(0))
        } else {
            reference
        },
        url: json["web_url"].as_str().unwrap_or("").to_string(),
        title: json["title"].as_str().unwrap_or("").to_string(),
        state: match json["state"].as_str().unwrap_or("") {
            "opened" => "Открыт".to_string(),
            "closed" => "Закрыт".to_string(),
            other => other.to_string(),
        },
        assignee: json["assignees"]
            .as_array()
            .and_then(|list| list.first())
            .and_then(|user| user["name"].as_str())
            .unwrap_or("unassigned")
            .to_string(),
        // GitLab has no priority field: teams express it with labels, so the
        // labels are what gets shown rather than an invented number.
        priority: json["labels"]
            .as_array()
            .map(|labels| {
                labels
                    .iter()
                    .filter_map(|l| l.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default(),
        estimate: humanize(time["human_time_estimate"].as_str().unwrap_or("")),
        spent: humanize(time["human_total_time_spent"].as_str().unwrap_or("")),
        deadline: json["due_date"].as_str().unwrap_or("").to_string(),
        issue_type: json["type"].as_str().unwrap_or("").to_string(),
        description: json["description"].as_str().unwrap_or("").to_string(),
    }
}

pub async fn fetch_issue(base_url: &str, token: &str, reference: &Reference) -> Result<Issue, String> {
    let url = format!(
        "{}/projects/{}/issues/{}",
        api(base_url),
        encode_project(&reference.project),
        reference.iid
    );

    let json = get(&url, token, &[]).await?;
    Ok(issue_from_json(&json))
}

pub async fn search_issues(
    base_url: &str,
    token: &str,
    text: &str,
    limit: usize,
) -> Result<Vec<IssueBrief>, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("Search text is empty".to_string());
    }

    // `scope=all` is what makes this search everything the user can see rather
    // than only the issues they created.
    let url = format!("{}/issues", api(base_url));
    let json = get(
        &url,
        token,
        &[
            ("search", text),
            ("scope", "all"),
            ("in", "title"),
            ("order_by", "updated_at"),
            ("per_page", &limit.clamp(1, 50).to_string()),
        ],
    )
    .await?;

    Ok(json
        .as_array()
        .map(|issues| {
            issues
                .iter()
                .map(|issue| IssueBrief {
                    provider: Provider::GitLab,
                    key: issue["references"]["full"]
                        .as_str()
                        .unwrap_or("")
                        .to_string(),
                    title: issue["title"].as_str().unwrap_or("").to_string(),
                    state: issue["state"].as_str().unwrap_or("").to_string(),
                    updated_at: issue["updated_at"]
                        .as_str()
                        .unwrap_or("")
                        .chars()
                        .take(10)
                        .collect(),
                    url: issue["web_url"].as_str().unwrap_or("").to_string(),
                })
                .collect()
        })
        .unwrap_or_default())
}

pub async fn create_issue(
    base_url: &str,
    token: &str,
    project: &str,
    title: &str,
    description: Option<&str>,
) -> Result<Issue, String> {
    let url = format!("{}/projects/{}/issues", api(base_url), encode_project(project));
    let client = Client::new();
    let mut body = serde_json::json!({ "title": title });
    if let Some(description) = description {
        body["description"] = Value::String(description.to_string());
    }

    let resp = client
        .post(&url)
        .header("PRIVATE-TOKEN", token)
        .timeout(std::time::Duration::from_secs(15))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("GitLab API error: {}", e))?;

    if !resp.status().is_success() {
        return Err(describe_failure(resp).await);
    }

    let json: Value = resp
        .json()
        .await
        .map_err(|e| format!("GitLab parse error: {}", e))?;
    Ok(issue_from_json(&json))
}

/// Who the token belongs to — the cheapest call that proves it works.
pub async fn whoami(base_url: &str, token: &str) -> Result<String, String> {
    let json = get(&format!("{}/user", api(base_url)), token, &[]).await?;
    Ok(json["name"]
        .as_str()
        .or_else(|| json["username"].as_str())
        .unwrap_or("unknown user")
        .to_string())
}

async fn get(url: &str, token: &str, query: &[(&str, &str)]) -> Result<Value, String> {
    let resp = Client::new()
        .get(url)
        .header("PRIVATE-TOKEN", token)
        .query(query)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("GitLab API error: {}", e))?;

    if !resp.status().is_success() {
        return Err(describe_failure(resp).await);
    }

    resp.json()
        .await
        .map_err(|e| format!("GitLab parse error: {}", e))
}

/// GitLab answers 401 for a bad token and 404 for both "no such issue" and "you
/// cannot see it", so the message says which without pretending to know more.
async fn describe_failure(resp: reqwest::Response) -> String {
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    match status.as_u16() {
        401 => "GitLab rejected the token. Check it in Settings → Integrations.".to_string(),
        403 => "The token does not have access to that project.".to_string(),
        404 => "No such issue, or the token cannot see it.".to_string(),
        _ => format!(
            "GitLab API HTTP {}: {}",
            status,
            crate::services::logger::snippet(&body, 200)
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_reference_from_every_shape_gitlab_hands_out() {
        let expected = Reference { project: "group/project".to_string(), iid: 42 };

        assert_eq!(
            parse_reference("https://gitlab.company.ru/group/project/-/issues/42"),
            Some(Reference { project: "group/project".into(), iid: 42 }),
        );
        // Work items are the same issue under a newer path.
        assert_eq!(
            parse_reference("https://gitlab.com/group/project/-/work_items/42"),
            Some(Reference { project: "group/project".into(), iid: 42 }),
        );
        // Anchors and query strings come along when a link is copied.
        assert_eq!(
            parse_reference("https://gitlab.com/group/project/-/issues/42#note_1"),
            Some(Reference { project: "group/project".into(), iid: 42 }),
        );
        assert_eq!(parse_reference("group/project#42"), Some(expected));
        // Deep subgroups are ordinary paths.
        assert_eq!(
            parse_reference("https://gitlab.com/a/b/c/-/issues/7"),
            Some(Reference { project: "a/b/c".into(), iid: 7 }),
        );
    }

    #[test]
    fn refuses_what_is_not_a_gitlab_issue() {
        assert_eq!(parse_reference("https://tracker.yandex.ru/QUEUE-1"), None);
        assert_eq!(parse_reference("QUEUE-1"), None);
        assert_eq!(parse_reference("#42"), None, "a bare number names no project");
        assert_eq!(parse_reference("https://gitlab.com/group/project"), None);
        assert_eq!(parse_reference(""), None);
    }

    #[test]
    fn durations_come_out_in_the_apps_words() {
        assert_eq!(humanize("4d 2h"), "4д 2ч");
        assert_eq!(humanize("1w 3d"), "1н 3д");
        assert_eq!(humanize("30m"), "30м");
        assert_eq!(humanize(""), "");
    }

    /// The shape below is a real answer from the GitLab API, trimmed.
    #[test]
    fn maps_an_issue_the_way_the_panel_needs_it() {
        let json: Value = serde_json::from_str(
            r#"{
                "iid": 628715,
                "title": "Remove GLCI_REBUILD_ASSETS_IMAGE",
                "state": "opened",
                "web_url": "https://gitlab.com/gitlab-org/gitlab/-/work_items/628715",
                "due_date": "2026-09-30",
                "labels": ["frontend", "type::maintenance"],
                "time_stats": {
                    "time_estimate": 14400,
                    "human_time_estimate": "4h",
                    "total_time_spent": 3600,
                    "human_total_time_spent": "1h"
                },
                "references": { "full": "gitlab-org/gitlab#628715" },
                "assignees": [{ "name": "Stanislav Lashmanov" }],
                "description": "text",
                "type": "ISSUE"
            }"#,
        )
        .unwrap();

        let issue = issue_from_json(&json);
        assert_eq!(issue.key, "gitlab-org/gitlab#628715");
        assert_eq!(issue.state, "Открыт");
        assert_eq!(issue.assignee, "Stanislav Lashmanov");
        assert_eq!(issue.estimate, "4ч");
        assert_eq!(issue.spent, "1ч");
        assert_eq!(issue.deadline, "2026-09-30");
        assert_eq!(issue.priority, "frontend, type::maintenance");
    }

    #[test]
    fn an_issue_with_nothing_filled_in_does_not_invent_values() {
        let json: Value = serde_json::from_str(
            r#"{ "iid": 7, "title": "t", "state": "closed", "time_stats": {}, "labels": [] }"#,
        )
        .unwrap();
        let issue = issue_from_json(&json);
        assert_eq!(issue.key, "#7");
        assert_eq!(issue.estimate, "");
        assert_eq!(issue.assignee, "unassigned");
        assert_eq!(issue.state, "Закрыт");
    }
}
