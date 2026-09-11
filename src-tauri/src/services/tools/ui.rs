//! Tools that drive the interface itself.
//!
//! Switching a view, opening a task, changing the theme — none of it lives in
//! the database, so these tools ask the window to do it and report that they
//! asked. The window is also where the catalogue of themes and views comes
//! from: it publishes what it can do (see `ui_catalog` in the settings), so the
//! two never drift apart.

use rusqlite::Connection;
use serde_json::{json, Value};

use super::{Availability, Danger, Handler, Tool};

/// What the interface says it offers — themes, views, languages.
pub fn list_appearance_options(conn: &Connection, _args: &Value) -> Result<String, String> {
    let catalog: String = conn
        .query_row("SELECT value FROM settings WHERE key = 'ui_catalog'", [], |r| r.get(0))
        .unwrap_or_default();

    if catalog.is_empty() {
        return Ok("The app has not published its appearance options yet".to_string());
    }
    Ok(catalog)
}

pub fn tools() -> Vec<Tool> {
    vec![
        Tool {
            name: "list_appearance_options",
            summary: "List the themes, views, settings sections and languages the app offers, with the ids to pass to set_appearance and open_view",
            keywords: &[
                "тема", "оформление", "цвета", "язык", "какие темы", "разделы настроек",
                "theme", "appearance", "colours", "language", "options", "settings sections",
            ],
            availability: Availability::OnDemand,
            danger: Danger::Safe,
            params: || json!({ "type": "object", "properties": {} }),
            handler: Handler::Db(list_appearance_options),
        },
        Tool {
            name: "set_appearance",
            summary: "Change the app's theme or light/dark mode. Get the available ids from list_appearance_options first.",
            keywords: &[
                "тема", "оформление", "тёмная", "светлая", "поменяй тему", "цветовая схема",
                "theme", "dark", "light", "appearance", "colour scheme",
            ],
            availability: Availability::OnDemand,
            danger: Danger::Safe,
            params: || {
                json!({
                    "type": "object",
                    "properties": {
                        "theme_id": { "type": "string", "description": "Theme id from list_appearance_options" },
                        "mode": { "type": "string", "enum": ["dark", "light", "auto"], "description": "Colour mode" },
                    }
                })
            },
            handler: Handler::Ui("set_appearance"),
        },
        Tool {
            name: "set_language",
            summary: "Switch the interface language",
            keywords: &["язык", "русский", "английский", "language", "russian", "english", "locale"],
            availability: Availability::OnDemand,
            danger: Danger::Safe,
            params: || {
                json!({
                    "type": "object",
                    "properties": { "locale": { "type": "string", "enum": ["ru", "en"] } },
                    "required": ["locale"]
                })
            },
            handler: Handler::Ui("set_language"),
        },
        Tool {
            name: "open_view",
            summary: "Show a screen: a project's board, everything in progress, the archive or one section of the settings",
            keywords: &[
                "открой", "покажи", "перейди", "экран", "архив", "настройки", "в работе",
                "оформление", "интеграции", "журнал", "логи",
                "open", "show", "go to", "screen", "archive", "settings", "board",
                "appearance", "integrations", "logs",
            ],
            availability: Availability::OnDemand,
            danger: Danger::Safe,
            params: || {
                json!({
                    "type": "object",
                    "properties": {
                        "view": { "type": "string", "enum": ["project", "all-doing", "archive", "settings"] },
                        "project_id": { "type": "string", "description": "Which project's board, when view is \"project\"" },
                        "section": { "type": "string", "description": "Which settings section, when view is \"settings\" — one of ui_catalog.settings_sections" },
                    },
                    "required": ["view"]
                })
            },
            handler: Handler::Ui("open_view"),
        },
        Tool {
            name: "open_task",
            summary: "Open a task's detail panel in front of the user",
            keywords: &["открой задачу", "покажи задачу", "open task", "show task", "focus task"],
            availability: Availability::OnDemand,
            danger: Danger::Safe,
            params: || {
                json!({
                    "type": "object",
                    "properties": { "task_id": { "type": "string" } },
                    "required": ["task_id"]
                })
            },
            handler: Handler::Ui("open_task"),
        },
    ]
}
