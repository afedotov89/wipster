//! Issues, whichever system they live in.
//!
//! Wipster links a task to an issue; some people keep those in Yandex Tracker,
//! some in GitLab, some in both. This module is the only place that knows the
//! difference: it recognises a link or a reference, asks the right provider, and
//! hands back the same shape either way, so the rest of the app — the panel, the
//! AI fill, the assistant's tools — never branches on which tracker a person
//! happens to use.

use rusqlite::Connection;
use std::sync::Mutex;

use super::{gitlab, tracker};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Provider {
    YandexTracker,
    GitLab,
}

impl Provider {
    pub fn label(self) -> &'static str {
        match self {
            Provider::YandexTracker => "Yandex Tracker",
            Provider::GitLab => "GitLab",
        }
    }
}

/// One issue, in the terms the app cares about.
pub struct Issue {
    pub provider: Provider,
    /// How a person refers to it: `QUEUE-123` or `group/project#42`.
    pub key: String,
    pub url: String,
    pub title: String,
    pub state: String,
    pub assignee: String,
    /// Tracker's priority, or GitLab's labels — whatever the system uses to say
    /// how this issue is classified.
    pub priority: String,
    pub estimate: String,
    pub spent: String,
    pub deadline: String,
    pub issue_type: String,
    pub description: String,
}

impl Issue {
    pub fn to_context_string(&self) -> String {
        let mut lines = vec![
            format!("## Linked issue: {} ({})", self.key, self.provider.label()),
            format!("- **Title**: {}", self.title),
            format!("- **State**: {}", self.state),
        ];
        let mut add = |label: &str, value: &str| {
            if !value.trim().is_empty() {
                lines.push(format!("- **{}**: {}", label, value));
            }
        };
        add("Type", &self.issue_type);
        add("Assignee", &self.assignee);
        add(
            match self.provider {
                Provider::YandexTracker => "Priority",
                Provider::GitLab => "Labels",
            },
            &self.priority,
        );
        add("Estimate", &self.estimate);
        add("Time spent", &self.spent);
        add("Deadline", &self.deadline);
        add("Link", &self.url);

        if !self.description.trim().is_empty() {
            lines.push(format!("\n### Description\n{}", self.description));
        }
        lines.join("\n")
    }
}

/// A search hit — enough to choose between issues without fetching each one.
pub struct IssueBrief {
    pub provider: Provider,
    pub key: String,
    pub title: String,
    pub state: String,
    pub updated_at: String,
    pub url: String,
}

impl IssueBrief {
    pub fn to_line(&self) -> String {
        format!(
            "- [{}] {} | {} | {} | updated {}\n  {}",
            self.provider.label(),
            self.key,
            self.title,
            self.state,
            self.updated_at,
            self.url
        )
    }
}

/// Credentials for whichever providers the user has set up.
pub struct Credentials {
    pub tracker: Option<(String, String)>,
    pub gitlab: Option<(String, String)>,
}

impl Credentials {
    pub fn read(db: &Mutex<Connection>) -> Self {
        let Ok(conn) = db.lock() else {
            return Credentials { tracker: None, gitlab: None };
        };
        let setting = |key: &str| {
            conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
                r.get::<_, String>(0)
            })
            .ok()
            .filter(|value| !value.trim().is_empty())
        };

        Credentials {
            tracker: setting("tracker_token").zip(setting("tracker_org_id")),
            gitlab: setting("gitlab_url").zip(setting("gitlab_token")),
        }
    }

    pub fn none_configured(&self) -> bool {
        self.tracker.is_none() && self.gitlab.is_none()
    }
}

/// Which provider a link or reference belongs to.
///
/// The decision is made from the text itself rather than from a global setting,
/// because a person with both systems pastes links from both.
pub fn detect(link: &str, credentials: &Credentials) -> Option<Provider> {
    let text = link.trim();
    if text.is_empty() {
        return None;
    }

    if text.contains("tracker.yandex.") || tracker::is_bare_issue_reference(text) {
        return Some(Provider::YandexTracker);
    }
    if gitlab::parse_reference(text).is_some() {
        return Some(Provider::GitLab);
    }
    // A host we were told is GitLab, even if the path is unusual.
    if let Some((base_url, _)) = &credentials.gitlab {
        if let Some(host) = base_url.split("://").nth(1).and_then(|rest| rest.split('/').next()) {
            if !host.is_empty() && text.contains(host) {
                return Some(Provider::GitLab);
            }
        }
    }
    None
}

/// Is this text nothing but a reference to an issue, in any connected system?
///
/// A title that is only a link says nothing about the work, and that is what
/// makes the app offer to fill the task in from the issue behind it. The rule
/// has to know about every provider, or pasting a GitLab link would behave
/// differently from pasting a tracker key.
pub fn is_bare_reference(text: &str, credentials: &Credentials) -> bool {
    let mut seen = false;
    for token in text.split_whitespace() {
        let is_reference = tracker::is_bare_issue_reference(token)
            || gitlab::parse_reference(token).is_some()
            || matches!(detect(token, credentials), Some(Provider::GitLab));
        if !is_reference {
            return false;
        }
        seen = true;
    }
    seen
}

/// The first issue any of this text points at, as a link to store on the task.
pub fn first_reference_url(text: &str, credentials: &Credentials) -> Option<String> {
    for token in text.split_whitespace() {
        match detect(token, credentials) {
            Some(Provider::YandexTracker) => {
                if let Some(key) = tracker::extract_issue_key(token) {
                    return Some(format!("https://tracker.yandex.ru/{}", key));
                }
            }
            Some(Provider::GitLab) => {
                if token.starts_with("http") {
                    return Some(token.trim_end_matches(&['.', ',', ')'][..]).to_string());
                }
                // A bare group/project#42 only becomes a link with a host.
                if let (Some(reference), Some((base_url, _))) =
                    (gitlab::parse_reference(token), &credentials.gitlab)
                {
                    return Some(format!(
                        "{}/{}/-/issues/{}",
                        base_url.trim_end_matches('/'),
                        reference.project,
                        reference.iid
                    ));
                }
            }
            None => {}
        }
    }
    None
}

/// Read an issue from whichever system it lives in.
pub async fn read(db: &Mutex<Connection>, link: &str) -> Result<Issue, String> {
    let credentials = Credentials::read(db);
    match detect(link, &credentials) {
        Some(Provider::YandexTracker) => {
            let (token, org_id) = credentials
                .tracker
                .ok_or("Yandex Tracker is not configured. Settings → Integrations.")?;
            let key = tracker::extract_issue_key(link).unwrap_or_else(|| link.trim().to_string());
            tracker::fetch_issue(&token, &org_id, &key).await
        }
        Some(Provider::GitLab) => {
            let (base_url, token) = credentials
                .gitlab
                .ok_or("GitLab is not configured. Settings → Integrations.")?;
            let reference = gitlab::parse_reference(link)
                .ok_or_else(|| format!("Not a GitLab issue reference: {}", link))?;
            gitlab::fetch_issue(&base_url, &token, &reference).await
        }
        None => Err(format!(
            "Cannot tell which tracker \"{}\" belongs to. Paste a full link, a QUEUE-123 key or a group/project#42 reference.",
            link.trim()
        )),
    }
}

/// Search every configured provider and merge what they say.
///
/// Merging rather than choosing: someone with both systems should not have to
/// say which one a half-remembered title is in.
pub async fn search(db: &Mutex<Connection>, text: &str, limit: usize) -> Result<Vec<IssueBrief>, String> {
    let credentials = Credentials::read(db);
    if credentials.none_configured() {
        return Err("No tracker is configured. Settings → Integrations.".to_string());
    }

    let mut found = Vec::new();
    let mut failures = Vec::new();

    if let Some((token, org_id)) = &credentials.tracker {
        match tracker::search_issues(token, org_id, text, None, limit).await {
            Ok(issues) => found.extend(issues),
            Err(e) => failures.push(format!("Yandex Tracker: {}", e)),
        }
    }
    if let Some((base_url, token)) = &credentials.gitlab {
        match gitlab::search_issues(base_url, token, text, limit).await {
            Ok(issues) => found.extend(issues),
            Err(e) => failures.push(format!("GitLab: {}", e)),
        }
    }

    // One provider being down should not hide what the other found.
    if found.is_empty() && !failures.is_empty() {
        return Err(failures.join("; "));
    }
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn both() -> Credentials {
        Credentials {
            tracker: Some(("t".into(), "o".into())),
            gitlab: Some(("https://gitlab.company.ru".into(), "g".into())),
        }
    }

    #[test]
    fn a_link_says_which_system_it_belongs_to() {
        let c = both();
        assert_eq!(detect("https://tracker.yandex.ru/RAG-1", &c), Some(Provider::YandexTracker));
        assert_eq!(detect("RAG-1", &c), Some(Provider::YandexTracker));
        assert_eq!(
            detect("https://gitlab.company.ru/team/app/-/issues/42", &c),
            Some(Provider::GitLab),
        );
        assert_eq!(detect("team/app#42", &c), Some(Provider::GitLab));
    }

    #[test]
    fn an_unusual_path_on_the_configured_host_is_still_gitlab() {
        let c = both();
        assert_eq!(
            detect("https://gitlab.company.ru/team/app/-/merge_requests/7", &c),
            Some(Provider::GitLab),
        );
    }

    #[test]
    fn nothing_recognisable_is_admitted_as_such() {
        let c = both();
        assert_eq!(detect("just some words", &c), None);
        assert_eq!(detect("", &c), None);
        assert_eq!(detect("https://example.com/page", &c), None);
    }

    #[test]
    fn a_title_that_is_only_a_link_is_recognised_for_either_system() {
        let c = both();
        assert!(is_bare_reference("RAG-1", &c));
        assert!(is_bare_reference("https://tracker.yandex.ru/RAG-1", &c));
        assert!(is_bare_reference("https://gitlab.company.ru/team/app/-/issues/42", &c));
        assert!(is_bare_reference("team/app#42", &c));

        // A title with words of its own is a title.
        assert!(!is_bare_reference("Оценить RAG-1", &c));
        assert!(!is_bare_reference("починить импорт", &c));
        assert!(!is_bare_reference("", &c));
    }

    #[test]
    fn a_reference_becomes_a_link_worth_storing() {
        let c = both();
        assert_eq!(
            first_reference_url("RAG-1", &c).as_deref(),
            Some("https://tracker.yandex.ru/RAG-1"),
        );
        assert_eq!(
            first_reference_url("смотри https://gitlab.company.ru/team/app/-/issues/42 там", &c).as_deref(),
            Some("https://gitlab.company.ru/team/app/-/issues/42"),
        );
        assert_eq!(
            first_reference_url("team/app#42", &c).as_deref(),
            Some("https://gitlab.company.ru/team/app/-/issues/42"),
        );
        assert_eq!(first_reference_url("ничего тут нет", &c), None);
    }

    #[test]
    fn the_context_leaves_out_what_the_issue_does_not_have() {
        let issue = Issue {
            provider: Provider::GitLab,
            key: "team/app#42".into(),
            url: "https://gitlab.company.ru/team/app/-/issues/42".into(),
            title: "Починить импорт".into(),
            state: "Открыт".into(),
            assignee: "unassigned".into(),
            priority: String::new(),
            estimate: String::new(),
            spent: String::new(),
            deadline: String::new(),
            issue_type: String::new(),
            description: String::new(),
        };
        let context = issue.to_context_string();
        assert!(context.contains("team/app#42 (GitLab)"));
        assert!(context.contains("Починить импорт"));
        assert!(!context.contains("Estimate"), "an empty estimate is not reported as one");
        assert!(!context.contains("Description"));
    }
}
