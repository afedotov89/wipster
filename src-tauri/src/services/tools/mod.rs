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

pub mod app;
pub mod coverage;
pub mod memory;
pub mod projects;
pub mod tasks;
pub mod issues;
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
/// Reaches the network. It is handed the database because that is where the
/// credentials live, and which tracker a request belongs to is decided per link.
type NetFn = for<'a> fn(&'a Mutex<Connection>, Value) -> Pin<Box<dyn Future<Output = String> + Send + 'a>>;

pub enum Handler {
    /// Runs against the local database.
    Db(DbFn),
    /// Goes out to a tracker over the network.
    Net(NetFn),
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
    all.extend(app::tools());
    all.extend(projects::tools());
    all.extend(memory::tools());
    all.extend(issues::tools());
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
    let words = split_words(query);

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
    let summary_words: Vec<String> = split_words(&tool.summary);
    let keyword_words: Vec<String> = tool.keywords.iter().flat_map(|k| split_words(k)).collect();

    words
        .iter()
        .map(|word| {
            if name.contains(word.as_str()) {
                4
            } else if keyword_words.iter().any(|k| alike(k, word)) {
                3
            } else if summary_words.iter().any(|s| alike(s, word)) {
                1
            } else {
                0
            }
        })
        .sum()
}

fn split_words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.chars().count() >= 3)
        .map(stem)
        .collect()
}

/// Two words mean the same thing closely enough to match.
fn alike(a: &str, b: &str) -> bool {
    a == b || a.contains(b) || b.contains(a)
}

/// Crude stemming, and deliberately so.
///
/// A user types "гитлабе", "темы", "проекта"; the keywords are written in the
/// dictionary form. Without trimming the ending, none of those find anything,
/// and a search that fails on a declined noun is no search at all. Cutting a
/// short tail off long words is enough for one-word matching and costs nothing
/// — the alternative is a morphology library for a dozen keywords.
fn stem(word: &str) -> String {
    const ENDINGS: [&str; 22] = [
        "ами", "ого", "ему", "ыми", "ой", "ом", "ам", "ах", "ов", "ев", "ий", "ый", "ая", "ое",
        "ую", "ые", "ие", "а", "я", "ы", "и", "е",
    ];
    let length = word.chars().count();
    if length <= 4 {
        return word.to_string();
    }
    for ending in ENDINGS {
        let tail = ending.chars().count();
        if word.ends_with(ending) && length - tail >= 4 {
            return word.chars().take(length - tail).collect();
        }
    }
    // English plurals, for the half of the vocabulary that is English.
    if length > 4 && word.ends_with('s') {
        return word.chars().take(length - 1).collect();
    }
    word.to_string()
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
        Handler::Net(run) => run(db, args.clone()).await,
    }
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
            ("найди тикет в трекере", "search_issues"),
            ("найди задачу в гитлабе", "search_issues"),
            ("открой тикет group/project#42", "read_issue"),
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
