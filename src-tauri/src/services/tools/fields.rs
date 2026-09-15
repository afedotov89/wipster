//! The shape of a task, as something the assistant can change.
//!
//! "Add a field for links to designs", "hide the energy bar", "what fields do
//! tasks have?" — all of it belongs to the assistant for the same reason every
//! other control does: the user should not have to know where the setting
//! lives. The rules are the service's, so nothing here can delete data either.

use rusqlite::Connection;
use serde_json::{json, Value};

use super::{Availability, Danger, Handler, Tool};
use crate::services::task_fields::{self, Kind, ALL_KINDS};

fn kinds_sentence() -> String {
    ALL_KINDS.iter().map(|k| k.as_str()).collect::<Vec<_>>().join(", ")
}

/// Find a field by id, key or the name the user gave it.
fn find(conn: &Connection, needle: &str) -> Result<task_fields::TaskField, String> {
    let needle = needle.trim();
    let all = task_fields::list(conn)?;
    all.iter()
        .find(|f| f.id == needle)
        .or_else(|| all.iter().find(|f| f.key.eq_ignore_ascii_case(needle)))
        .or_else(|| {
            all.iter()
                .find(|f| f.label.as_deref().map(|l| l.eq_ignore_ascii_case(needle)) == Some(true))
        })
        .cloned()
        .ok_or_else(|| {
            format!(
                "No field \"{needle}\". There is: {}",
                all.iter()
                    .map(|f| f.label.clone().unwrap_or_else(|| f.key.clone()))
                    .collect::<Vec<_>>()
                    .join(", "),
            )
        })
}

pub fn list_task_fields(conn: &Connection, _args: &Value) -> Result<String, String> {
    let fields = task_fields::list(conn)?;
    let lines: Vec<String> = fields
        .iter()
        .map(|f| {
            format!(
                "{} — {} ({}{}){}",
                f.label.clone().unwrap_or_else(|| f.key.clone()),
                f.kind,
                if f.builtin { "built-in" } else { "custom" },
                if f.enabled { "" } else { ", hidden" },
                if f.options.is_empty() { String::new() } else { format!(" [{}]", f.options.join(", ")) },
            )
        })
        .collect();

    let removed = task_fields::removed_with_values(conn)?;
    let mut answer = format!("Fields of a task, in order:\n{}", lines.join("\n"));
    if !removed.is_empty() {
        answer.push_str(&format!(
            "\n\nRemoved, but their values are kept and they can be restored: {}",
            removed
                .iter()
                .map(|f| f.label.clone().unwrap_or_else(|| f.key.clone()))
                .collect::<Vec<_>>()
                .join(", "),
        ));
    }
    Ok(answer)
}

pub fn create_task_field(conn: &Connection, args: &Value) -> Result<String, String> {
    let label = args["label"].as_str().unwrap_or("").to_string();
    let kind = Kind::parse(args["kind"].as_str().unwrap_or(""))?;
    let options: Vec<String> = args["options"]
        .as_array()
        .map(|items| items.iter().filter_map(|i| i.as_str().map(str::to_string)).collect())
        .unwrap_or_default();

    let field = task_fields::create(conn, &label, kind, &options)?;
    Ok(format!(
        "Added the field \"{}\" ({}). It shows on every task.",
        field.label.unwrap_or(field.key),
        field.kind,
    ))
}

pub fn update_task_field(conn: &Connection, args: &Value) -> Result<String, String> {
    let field = find(conn, args["field"].as_str().unwrap_or(""))?;
    let label = args["label"].as_str();
    let enabled = args["enabled"].as_bool();
    let options: Option<Vec<String>> = args["options"].as_array().map(|items| {
        items.iter().filter_map(|i| i.as_str().map(str::to_string)).collect()
    });

    let side = args["column"].as_str();
    let updated =
        task_fields::update(conn, &field.id, label, enabled, options.as_deref(), side)?;
    let name = updated.label.clone().unwrap_or_else(|| updated.key.clone());
    Ok(match enabled {
        Some(true) => format!("\"{name}\" shows again, with everything it held."),
        Some(false) => format!("\"{name}\" is hidden. Nothing it holds was deleted."),
        None => format!("\"{name}\" updated."),
    })
}

pub fn remove_task_field(conn: &Connection, args: &Value) -> Result<String, String> {
    let field = find(conn, args["field"].as_str().unwrap_or(""))?;
    let name = field.label.clone().unwrap_or_else(|| field.key.clone());
    task_fields::remove(conn, &field.id)?;
    Ok(format!(
        "\"{name}\" is out of the list. What tasks hold in it is kept and comes back if it is restored.",
    ))
}

pub fn set_task_field(conn: &Connection, args: &Value) -> Result<String, String> {
    let task_id = args["task_id"].as_str().unwrap_or("").to_string();
    let field = find(conn, args["field"].as_str().unwrap_or(""))?;
    let value = args.get("value").cloned().unwrap_or(Value::Null);

    task_fields::set_value(conn, &task_id, &field.id, &value)?;
    Ok(format!(
        "\"{}\" set for task {task_id}.",
        field.label.unwrap_or(field.key),
    ))
}

pub fn tools() -> Vec<Tool> {
    vec![
        Tool {
            name: "list_task_fields",
            summary: "The fields a task has: built-in and custom, their types, and which are hidden",
            keywords: &[
                "поля", "поле задачи", "какие поля", "настройка полей", "типы полей",
                "fields", "task fields", "custom field", "field types",
            ],
            availability: Availability::OnDemand,
            danger: Danger::Safe,
            params: || json!({ "type": "object", "properties": {} }),
            handler: Handler::Db(list_task_fields),
        },
        Tool {
            name: "create_task_field",
            summary: "Add a field of the user's own to every task",
            keywords: &[
                "добавь поле", "новое поле", "своё поле", "список ссылок", "список файлов",
                "add field", "new field", "custom field",
            ],
            availability: Availability::OnDemand,
            danger: Danger::Safe,
            params: || {
                json!({
                    "type": "object",
                    "properties": {
                        "label": { "type": "string", "description": "What to call it, in the user's language" },
                        "kind": { "type": "string", "description": format!("One of: {}", kinds_sentence()) },
                        "options": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "The choices, when kind is \"select\"",
                        },
                    },
                    "required": ["label", "kind"]
                })
            },
            handler: Handler::Db(create_task_field),
        },
        Tool {
            name: "update_task_field",
            summary: "Show or hide a field, rename a custom one, or change its choices. Hiding never deletes values.",
            keywords: &[
                "скрой поле", "убери поле", "покажи поле", "переименуй поле", "включи поле",
                "hide field", "show field", "rename field", "enable field",
            ],
            availability: Availability::OnDemand,
            danger: Danger::Safe,
            params: || {
                json!({
                    "type": "object",
                    "properties": {
                        "field": { "type": "string", "description": "Its name, key or id" },
                        "enabled": { "type": "boolean", "description": "false hides it, true brings it back" },
                        "label": { "type": "string", "description": "A new name — custom fields only" },
                        "options": { "type": "array", "items": { "type": "string" } },
                        "column": {
                            "type": "string",
                            "enum": ["main", "side", "auto"],
                            "description": "Where it sits when a task fills the window",
                        },
                    },
                    "required": ["field"]
                })
            },
            handler: Handler::Db(update_task_field),
        },
        Tool {
            name: "remove_task_field",
            summary: "Take a custom field out of the list. Its values are kept and it can be restored.",
            keywords: &["удали поле", "убрать поле совсем", "delete field", "remove field"],
            availability: Availability::OnDemand,
            danger: Danger::Confirm,
            params: || {
                json!({
                    "type": "object",
                    "properties": { "field": { "type": "string", "description": "Its name, key or id" } },
                    "required": ["field"]
                })
            },
            handler: Handler::Db(remove_task_field),
        },
        Tool {
            name: "set_task_field",
            summary: "Write a custom field on a task — a link, a list of files, a number. Built-in fields go through update_task.",
            keywords: &[
                "запиши в поле", "заполни поле", "поставь значение", "добавь ссылку", "добавь файл",
                "set field", "field value", "fill field",
            ],
            availability: Availability::OnDemand,
            danger: Danger::Safe,
            params: || {
                json!({
                    "type": "object",
                    "properties": {
                        "task_id": { "type": "string" },
                        "field": { "type": "string", "description": "Its name, key or id" },
                        "value": { "description": "A string, a number, true/false, or an array for list fields" },
                    },
                    "required": ["task_id", "field", "value"]
                })
            },
            handler: Handler::Db(set_task_field),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        crate::db::migrations::run(&conn).unwrap();
        conn.execute("INSERT INTO tasks (id, title) VALUES ('t1', 'Задача')", []).unwrap();
        conn
    }

    #[test]
    fn it_lists_what_a_task_is_made_of() {
        let answer = list_task_fields(&db(), &json!({})).unwrap();
        assert!(answer.contains("priority"));
        assert!(answer.contains("built-in"));
    }

    #[test]
    fn it_adds_a_field_and_writes_to_it_by_name() {
        let conn = db();
        create_task_field(&conn, &json!({"label": "Макеты", "kind": "url_list"})).unwrap();

        let answer = set_task_field(
            &conn,
            &json!({"task_id": "t1", "field": "Макеты", "value": ["https://figma.com/x"]}),
        )
        .unwrap();

        assert!(answer.contains("Макеты"));
        let values = task_fields::values(&conn, "t1").unwrap();
        assert_eq!(values.as_object().unwrap().len(), 1);
    }

    #[test]
    fn hiding_a_field_says_out_loud_that_nothing_was_deleted() {
        let conn = db();
        let answer =
            update_task_field(&conn, &json!({"field": "energy", "enabled": false})).unwrap();
        assert!(answer.contains("Nothing"), "{answer}");
    }

    #[test]
    fn a_field_that_does_not_exist_gets_the_list_of_ones_that_do() {
        let err = set_task_field(&db(), &json!({"task_id": "t1", "field": "выдумка", "value": "x"}))
            .unwrap_err();
        assert!(err.contains("priority"), "{err}");
    }

    #[test]
    fn built_in_fields_cannot_be_removed_through_the_assistant_either() {
        let err = remove_task_field(&db(), &json!({"field": "priority"})).unwrap_err();
        assert!(err.contains("switched off"), "{err}");
    }
}
