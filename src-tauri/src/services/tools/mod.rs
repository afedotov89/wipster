//! The catalogue of everything the assistant can do.
//!
//! One registry is the single source of truth: it carries each tool's name, the
//! sentence the model reads, the words it can be found by, its parameters and
//! the code that runs it. Nothing about a tool lives anywhere else, so a tool
//! cannot exist in the prompt but not in the dispatcher, or the other way round.
//!
//! The catalogue is deliberately larger than what any one request needs, which
//! is why it is not handed to the model whole: [`core`] is always in the prompt,
//! everything else is found with `find_tools` and added to the conversation as
//! it becomes relevant. A small model then sees a handful of tools with real
//! schemas instead of a wall of them.

use rusqlite::Connection;
use serde_json::{json, Value};
use std::future::Future;
use std::pin::Pin;
use std::sync::Mutex;

pub mod coverage;
pub mod memory;
pub mod projects;
pub mod tasks;
pub mod tracker;
pub mod ui;
pub mod workflow;

/// How much of the catalogue the model sees before it goes looking.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Availability {
    /// Always in the prompt: the handful of tools almost every request needs.
    Core,
    /// Found through `find_tools` when the request calls for it.
    OnDemand,
}

/// Whether doing this needs the user's word first.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Danger {
    /// Reversible: undo covers it, or it changes nothing.
    Safe,
    /// Destroys or publishes something — the UI asks before it runs.
    Confirm,
}

type DbFn = fn(&Connection, &Value) -> Result<String, String>;
type NetFn = fn(String, String, Value) -> Pin<Box<dyn Future<Output = String> + Send>>;

pub enum Handler {
    /// Runs against the local database.
    Db(DbFn),
    /// Needs the tracker: receives the token and organisation id.
    Tracker(NetFn),
    /// Cannot be done in the database at all — the window is asked to do it.
    /// The string is the action the interface knows by name.
    Ui(&'static str),
}

pub struct Tool {
    pub name: &'static str,
    /// One line, written for the model: what it does and when to reach for it.
    pub summary: &'static str,
    /// Words a user might use for this, in both languages the app speaks —
    /// this is what `find_tools` matches against.
    pub keywords: &'static [&'static str],
    pub availability: Availability,
    pub danger: Danger,
    pub params: fn() -> Value,
    pub handler: Handler,
}

impl Tool {
    /// The JSON the model is given for this tool.
    pub fn definition(&self) -> Value {
        json!({
            "name": self.name,
            "description": self.summary,
            "parameters": (self.params)(),
        })
    }
}

/// Every tool the assistant has.
pub fn registry() -> Vec<Tool> {
    let mut all = Vec::new();
    all.extend(tasks::tools());
    all.extend(projects::tools());
    all.extend(memory::tools());
    all.extend(tracker::tools());
    all.extend(workflow::tools());
    all.extend(ui::tools());
    all
}

/// The tools that go into every conversation.
pub fn core() -> Vec<Tool> {
    registry()
        .into_iter()
        .filter(|t| t.availability == Availability::Core)
        .collect()
}

pub fn by_name(name: &str) -> Option<Tool> {
    registry().into_iter().find(|t| t.name == name)
}

pub fn is_dangerous(name: &str) -> bool {
    by_name(name).map(|t| t.danger == Danger::Confirm).unwrap_or(false)
}

/// Tools worth showing for a request phrased like `query`.
///
/// Matching is deliberately forgiving — a weak model asking for "цвет проекта"
/// or "theme" should land on the same tool — so it scores name, summary and
/// keywords, in either language, and returns the best few rather than
/// everything that touched a letter.
pub fn find(query: &str, limit: usize) -> Vec<Tool> {
    let words: Vec<String> = query
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.chars().count() >= 3)
        .map(str::to_string)
        .collect();

    let mut scored: Vec<(usize, Tool)> = registry()
        .into_iter()
        .filter_map(|tool| {
            let score = score(&tool, &words);
            (score > 0).then_some((score, tool))
        })
        .collect();

    scored.sort_by(|a, b| b.0.cmp(&a.0));
    scored.into_iter().take(limit).map(|(_, tool)| tool).collect()
}

fn score(tool: &Tool, words: &[String]) -> usize {
    if words.is_empty() {
        return 0;
    }
    let name = tool.name.to_lowercase();
    let summary = tool.summary.to_lowercase();
    words
        .iter()
        .map(|word| {
            if name.contains(word.as_str()) {
                4
            } else if tool.keywords.iter().any(|k| k.to_lowercase().contains(word.as_str())) {
                3
            } else if summary.contains(word.as_str()) {
                1
            } else {
                0
            }
        })
        .sum()
}

/// Run a tool by name.
pub async fn execute(name: &str, args: &Value, db: &Mutex<Connection>) -> String {
    let Some(tool) = by_name(name) else {
        return format!("Unknown tool: {}", name);
    };

    match tool.handler {
        Handler::Db(run) => {
            let Ok(conn) = db.lock() else {
                return "Database is busy".to_string();
            };
            run(&conn, args).unwrap_or_else(|e| format!("Error: {}", e))
        }
        Handler::Ui(action) => crate::services::ui_bridge::request(action, args.clone()),
        Handler::Tracker(run) => {
            let (token, org_id) = tracker_credentials(db);
            match (token, org_id) {
                (Some(token), Some(org_id)) => run(token, org_id, args.clone()).await,
                _ => "Tracker not configured. Go to Settings → Integrations.".to_string(),
            }
        }
    }
}

/// The tracker token and organisation, or `None` when it has not been set up.
fn tracker_credentials(db: &Mutex<Connection>) -> (Option<String>, Option<String>) {
    let Ok(conn) = db.lock() else {
        return (None, None);
    };
    let read = |key: &str| {
        conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
            r.get::<_, String>(0)
        })
        .ok()
    };
    (read("tracker_token"), read("tracker_org_id"))
}

// ---- Shared by the handlers ----

pub fn record(conn: &Connection, action: &str, entity_type: &str, entity_id: &str, old: Option<&str>, new: Option<&str>) {
    let _ = crate::services::undo_redo::record_change(conn, action, entity_type, entity_id, old, new, None);
}

/// Full-fidelity snapshot so undo/redo can restore every column, not just the
/// ones the assistant happened to touch.
pub fn task_snapshot(conn: &Connection, id: &str) -> Option<String> {
    use crate::models::task::{task_from_row, TASK_COLUMNS};
    conn.query_row(
        &format!("SELECT {} FROM tasks WHERE id = ?1", TASK_COLUMNS),
        [id],
        task_from_row,
    )
    .ok()
    .and_then(|task| serde_json::to_string(&task).ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn top(query: &str) -> Vec<String> {
        find(query, 4).into_iter().map(|t| t.name.to_string()).collect()
    }

    /// The catalogue is only useful if a plainly worded request finds it, in
    /// either language — this is the whole bet behind not showing every tool at
    /// once, so it is checked the way a user would phrase things.
    #[test]
    fn a_request_in_plain_words_finds_its_tool() {
        for (query, expected) in [
            ("поменяй цвет проекта", "update_project"),
            ("change the project colour", "update_project"),
            ("создай проект", "create_project"),
            ("поменяй тему оформления", "set_appearance"),
            ("switch to dark theme", "set_appearance"),
            ("покажи архив", "list_archived_tasks"),
            ("отмени последнее действие", "undo_last"),
            ("поменяй лимит задач в работе", "set_wip_limit"),
            ("найди тикет в трекере", "search_tracker_issues"),
            ("открой настройки", "open_view"),
            ("смени язык на английский", "set_language"),
            ("что я делал вчера", "recent_changes"),
        ] {
            let found = top(query);
            assert!(
                found.contains(&expected.to_string()),
                "\"{}\" should find {}, found {:?}",
                query,
                expected,
                found,
            );
        }
    }

    #[test]
    fn nonsense_finds_nothing_rather_than_everything() {
        assert!(find("zzzz qqqq", 5).is_empty());
        assert!(find("", 5).is_empty());
    }

    #[test]
    fn the_core_set_stays_small_enough_for_a_small_model() {
        let core = core();
        assert!(
            core.len() <= 8,
            "the always-on toolset has grown to {} — that is a wall of text for a small model",
            core.len(),
        );
        // The ones every second request needs must be in it.
        for name in ["list_tasks", "search_tasks", "update_task", "create_task", "list_projects"] {
            assert!(core.iter().any(|t| t.name == name), "{} should be core", name);
        }
    }

    #[test]
    fn tool_names_are_unique() {
        let mut names: Vec<&str> = registry().iter().map(|t| t.name).collect();
        names.sort_unstable();
        let count = names.len();
        names.dedup();
        assert_eq!(names.len(), count, "two tools share a name");
    }
}
