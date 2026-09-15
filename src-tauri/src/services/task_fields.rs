//! What a task is made of.
//!
//! The set of fields is the user's to decide: built-in ones can be switched
//! off, custom ones added, and both reordered. Two rules hold this together and
//! neither is negotiable:
//!
//! - **Nothing here deletes what was typed.** Switching a field off hides it;
//!   removing a custom one marks it removed. The values stay where they are —
//!   in the `tasks` columns for built-ins, in `task_field_values` for the rest
//!   — so turning a field back on brings its content back with it.
//! - **Built-in fields keep their own editors.** They are not generic rows with
//!   a type; they are the priority picker, the date chips, the checklist. The
//!   registry decides whether and in what order they appear, not how they look.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

/// What a field holds, and therefore how it is edited.
///
/// Deliberately wide: a task can carry a list of files as naturally as a
/// number, and a list of links as naturally as a date.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    /// One line.
    Text,
    /// Several lines.
    LongText,
    Number,
    /// `YYYY-MM-DD`.
    Date,
    /// On or off.
    Checkbox,
    /// One of a fixed list.
    Select,
    /// A single address, openable.
    Url,
    /// Addresses, in order, each openable.
    UrlList,
    /// Paths on this machine, each revealable in Finder.
    FileList,
    /// Lines of text, in order.
    TextList,
    /// The steps of a task — built-in, with its own editor.
    Checklist,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Text => "text",
            Kind::LongText => "long_text",
            Kind::Number => "number",
            Kind::Date => "date",
            Kind::Checkbox => "checkbox",
            Kind::Select => "select",
            Kind::Url => "url",
            Kind::UrlList => "url_list",
            Kind::FileList => "file_list",
            Kind::TextList => "text_list",
            Kind::Checklist => "checklist",
        }
    }

    pub fn parse(value: &str) -> Result<Kind, String> {
        Ok(match value {
            "text" => Kind::Text,
            "long_text" => Kind::LongText,
            "number" => Kind::Number,
            "date" => Kind::Date,
            "checkbox" => Kind::Checkbox,
            "select" => Kind::Select,
            "url" => Kind::Url,
            "url_list" => Kind::UrlList,
            "file_list" => Kind::FileList,
            "text_list" => Kind::TextList,
            "checklist" => Kind::Checklist,
            other => {
                return Err(format!(
                    "Unknown field type \"{other}\". Available: {}",
                    ALL_KINDS.iter().map(|k| k.as_str()).collect::<Vec<_>>().join(", "),
                ))
            }
        })
    }

    /// Whether a value of this kind is a list.
    pub fn is_list(self) -> bool {
        matches!(self, Kind::UrlList | Kind::FileList | Kind::TextList)
    }
}

/// Every type a custom field can have, in the order the picker offers them.
pub const ALL_KINDS: &[Kind] = &[
    Kind::Text,
    Kind::LongText,
    Kind::Number,
    Kind::Date,
    Kind::Checkbox,
    Kind::Select,
    Kind::Url,
    Kind::UrlList,
    Kind::FileList,
    Kind::TextList,
];

/// One field of a task, as configured.
#[derive(Debug, Clone, Serialize)]
pub struct TaskField {
    pub id: String,
    /// The column name for a built-in field, a slug for a custom one.
    pub key: String,
    /// What the user called it. Built-in fields have none: the app names them
    /// in the interface language.
    pub label: Option<String>,
    pub kind: String,
    /// Choices, for `select`.
    pub options: Vec<String>,
    pub builtin: bool,
    pub enabled: bool,
    pub position: i32,
    /// When a custom field was taken out of the list. Its values remain.
    pub removed_at: Option<String>,
}

fn row_to_field(row: &rusqlite::Row) -> rusqlite::Result<TaskField> {
    let options: String = row.get(4)?;
    Ok(TaskField {
        id: row.get(0)?,
        key: row.get(1)?,
        label: row.get(2)?,
        kind: row.get(3)?,
        options: serde_json::from_str(&options).unwrap_or_default(),
        builtin: row.get::<_, i32>(5)? == 1,
        enabled: row.get::<_, i32>(6)? == 1,
        position: row.get(7)?,
        removed_at: row.get(8)?,
    })
}

const COLUMNS: &str =
    "id, key, label, kind, options, builtin, enabled, position, removed_at";

/// The fields in the list, in their order. Removed ones are left out.
pub fn list(conn: &Connection) -> Result<Vec<TaskField>, String> {
    let sql = format!(
        "SELECT {COLUMNS} FROM task_fields WHERE removed_at IS NULL ORDER BY position, rowid"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let fields = stmt
        .query_map([], row_to_field)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(fields)
}

/// A field by id, removed or not — values outlive the list, so readers of old
/// values still need to know what they were called.
pub fn get(conn: &Connection, id: &str) -> Result<TaskField, String> {
    let sql = format!("SELECT {COLUMNS} FROM task_fields WHERE id = ?1");
    conn.query_row(&sql, [id], row_to_field)
        .map_err(|_| format!("No task field with id {id}"))
}

/// Turn a label into a key that is stable, unique and readable in an export.
fn slug(label: &str, conn: &Connection) -> String {
    let base: String = label
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect::<String>()
        .trim_matches('_')
        .to_string();
    let base = if base.is_empty() { "field".to_string() } else { base };

    let mut candidate = base.clone();
    let mut n = 2;
    while conn
        .query_row("SELECT 1 FROM task_fields WHERE key = ?1", [&candidate], |_| Ok(()))
        .is_ok()
    {
        candidate = format!("{base}_{n}");
        n += 1;
    }
    candidate
}

/// Add a field of the user's own.
pub fn create(
    conn: &Connection,
    label: &str,
    kind: Kind,
    options: &[String],
) -> Result<TaskField, String> {
    let label = label.trim();
    if label.is_empty() {
        return Err("A field needs a name".to_string());
    }
    if kind == Kind::Select && options.is_empty() {
        return Err("A choice field needs at least one option".to_string());
    }

    let id = uuid::Uuid::new_v4().to_string();
    let key = slug(label, conn);
    let next_position: i32 = conn
        .query_row("SELECT COALESCE(MAX(position), -1) + 1 FROM task_fields", [], |r| r.get(0))
        .unwrap_or(0);

    conn.execute(
        "INSERT INTO task_fields (id, key, label, kind, options, builtin, enabled, position)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, 1, ?6)",
        params![
            id,
            key,
            label,
            kind.as_str(),
            serde_json::to_string(options).unwrap_or_else(|_| "[]".into()),
            next_position,
        ],
    )
    .map_err(|e| e.to_string())?;

    get(conn, &id)
}

/// Change what a field is called, whether it shows, or what it offers.
///
/// A built-in field can be switched off and reordered but not renamed or
/// retyped: its editor and its column are what they are.
pub fn update(
    conn: &Connection,
    id: &str,
    label: Option<&str>,
    enabled: Option<bool>,
    options: Option<&[String]>,
) -> Result<TaskField, String> {
    let field = get(conn, id)?;

    if let Some(enabled) = enabled {
        conn.execute(
            "UPDATE task_fields SET enabled = ?2 WHERE id = ?1",
            params![id, if enabled { 1 } else { 0 }],
        )
        .map_err(|e| e.to_string())?;
    }

    if let Some(label) = label {
        if field.builtin {
            return Err("Built-in fields keep their names".to_string());
        }
        let label = label.trim();
        if label.is_empty() {
            return Err("A field needs a name".to_string());
        }
        conn.execute("UPDATE task_fields SET label = ?2 WHERE id = ?1", params![id, label])
            .map_err(|e| e.to_string())?;
    }

    if let Some(options) = options {
        if field.builtin {
            return Err("Built-in fields keep their own choices".to_string());
        }
        conn.execute(
            "UPDATE task_fields SET options = ?2 WHERE id = ?1",
            params![id, serde_json::to_string(options).unwrap_or_else(|_| "[]".into())],
        )
        .map_err(|e| e.to_string())?;
    }

    get(conn, id)
}

/// Put the fields in this order. Anything not named keeps its place at the end.
pub fn reorder(conn: &Connection, ids: &[String]) -> Result<(), String> {
    for (position, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE task_fields SET position = ?2 WHERE id = ?1",
            params![id, position as i32],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Take a custom field out of the list.
///
/// The values it holds are left untouched on purpose: a field removed by
/// mistake, or removed and wanted back a month later, must not take a month of
/// typing with it.
pub fn remove(conn: &Connection, id: &str) -> Result<(), String> {
    let field = get(conn, id)?;
    if field.builtin {
        return Err("A built-in field can be switched off, but not removed".to_string());
    }
    conn.execute(
        "UPDATE task_fields SET removed_at = datetime('now'), enabled = 0 WHERE id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// A field that was removed, back in the list with everything it held.
pub fn restore(conn: &Connection, id: &str) -> Result<TaskField, String> {
    conn.execute(
        "UPDATE task_fields SET removed_at = NULL, enabled = 1 WHERE id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    get(conn, id)
}

/// Custom fields that were removed but still hold values — offered for
/// restoring rather than quietly forgotten.
pub fn removed_with_values(conn: &Connection) -> Result<Vec<TaskField>, String> {
    let sql = format!(
        "SELECT {COLUMNS} FROM task_fields f
         WHERE f.removed_at IS NOT NULL
           AND EXISTS (SELECT 1 FROM task_field_values v WHERE v.field_id = f.id)
         ORDER BY f.removed_at DESC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let fields = stmt
        .query_map([], row_to_field)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(fields)
}

/// Everything a task holds in its custom fields, keyed by field id.
pub fn values(conn: &Connection, task_id: &str) -> Result<serde_json::Value, String> {
    let mut stmt = conn
        .prepare("SELECT field_id, value FROM task_field_values WHERE task_id = ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([task_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;

    let mut map = serde_json::Map::new();
    for row in rows {
        let (field_id, raw) = row.map_err(|e| e.to_string())?;
        let parsed = serde_json::from_str(&raw).unwrap_or(serde_json::Value::String(raw));
        map.insert(field_id, parsed);
    }
    Ok(serde_json::Value::Object(map))
}

/// Write one value, after checking it is what the field says it is.
pub fn set_value(
    conn: &Connection,
    task_id: &str,
    field_id: &str,
    value: &serde_json::Value,
) -> Result<(), String> {
    let field = get(conn, field_id)?;
    if field.builtin {
        return Err(format!(
            "\"{}\" is a built-in field — write it with update_task",
            field.key,
        ));
    }
    let kind = Kind::parse(&field.kind)?;
    let value = coerce(kind, value, &field.options)?;

    // An emptied field is an absent one, so a task never carries rows of "".
    if is_empty(&value) {
        conn.execute(
            "DELETE FROM task_field_values WHERE task_id = ?1 AND field_id = ?2",
            params![task_id, field_id],
        )
        .map_err(|e| e.to_string())?;
        return Ok(());
    }

    conn.execute(
        "INSERT INTO task_field_values (task_id, field_id, value, updated_at)
         VALUES (?1, ?2, ?3, datetime('now'))
         ON CONFLICT (task_id, field_id) DO UPDATE SET value = ?3, updated_at = datetime('now')",
        params![task_id, field_id, serde_json::to_string(&value).unwrap_or_default()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn is_empty(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Null => true,
        serde_json::Value::String(s) => s.trim().is_empty(),
        serde_json::Value::Array(items) => items.is_empty(),
        _ => false,
    }
}

/// Make a value fit its field, or say why it cannot.
///
/// Forgiving where forgiveness is harmless — a number typed as text, a single
/// link where a list is expected — and strict where it is not: a choice field
/// only takes one of its choices, a date only takes a date.
pub fn coerce(
    kind: Kind,
    value: &serde_json::Value,
    options: &[String],
) -> Result<serde_json::Value, String> {
    use serde_json::Value;

    if value.is_null() {
        return Ok(Value::Null);
    }

    if kind.is_list() {
        let items: Vec<String> = match value {
            Value::Array(items) => items
                .iter()
                .map(|i| match i {
                    Value::String(s) => s.trim().to_string(),
                    other => other.to_string(),
                })
                .filter(|s| !s.is_empty())
                .collect(),
            Value::String(s) => s
                .lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect(),
            other => return Err(format!("Expected a list, got {other}")),
        };
        return Ok(Value::Array(items.into_iter().map(Value::String).collect()));
    }

    match kind {
        Kind::Number => match value {
            Value::Number(_) => Ok(value.clone()),
            Value::String(s) => s
                .trim()
                .replace(',', ".")
                .parse::<f64>()
                .map(|n| serde_json::json!(n))
                .map_err(|_| format!("\"{s}\" is not a number")),
            other => Err(format!("Expected a number, got {other}")),
        },
        Kind::Checkbox => match value {
            Value::Bool(_) => Ok(value.clone()),
            Value::String(s) => Ok(Value::Bool(matches!(
                s.trim().to_lowercase().as_str(),
                "true" | "yes" | "да" | "1"
            ))),
            other => Err(format!("Expected yes or no, got {other}")),
        },
        Kind::Date => {
            let text = value.as_str().unwrap_or_default().trim().to_string();
            if text.is_empty() {
                return Ok(Value::Null);
            }
            let looks_like_a_date = text.len() == 10
                && text.matches('-').count() == 2
                && text.chars().filter(char::is_ascii_digit).count() == 8;
            if !looks_like_a_date {
                return Err(format!("\"{text}\" is not a date — use YYYY-MM-DD"));
            }
            Ok(Value::String(text))
        }
        Kind::Select => {
            let text = value.as_str().unwrap_or_default().trim().to_string();
            if text.is_empty() {
                return Ok(Value::Null);
            }
            if !options.iter().any(|o| o == &text) {
                return Err(format!(
                    "\"{text}\" is not one of the choices: {}",
                    options.join(", "),
                ));
            }
            Ok(Value::String(text))
        }
        _ => Ok(Value::String(
            value.as_str().map(str::to_string).unwrap_or_else(|| value.to_string()),
        )),
    }
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
    fn a_new_field_lands_at_the_end_with_a_readable_key() {
        let conn = db();
        let field = create(&conn, "Ссылки на макеты", Kind::UrlList, &[]).unwrap();

        assert_eq!(field.key, "ссылки_на_макеты");
        assert!(!field.builtin);
        assert!(field.enabled);
        assert_eq!(list(&conn).unwrap().last().unwrap().id, field.id);
    }

    #[test]
    fn two_fields_with_the_same_name_do_not_collide() {
        let conn = db();
        let first = create(&conn, "Файлы", Kind::FileList, &[]).unwrap();
        let second = create(&conn, "Файлы", Kind::FileList, &[]).unwrap();

        assert_ne!(first.key, second.key);
    }

    /// The point of the whole feature: hiding a field must not cost data.
    #[test]
    fn switching_a_field_off_keeps_what_it_held() {
        let conn = db();
        let field = create(&conn, "Ссылки", Kind::UrlList, &[]).unwrap();
        set_value(&conn, "t1", &field.id, &serde_json::json!(["https://a.ru"])).unwrap();

        update(&conn, &field.id, None, Some(false), None).unwrap();

        assert_eq!(
            values(&conn, "t1").unwrap()[&field.id],
            serde_json::json!(["https://a.ru"]),
        );
    }

    /// And neither must removing one.
    #[test]
    fn a_removed_field_keeps_its_values_and_can_come_back() {
        let conn = db();
        let field = create(&conn, "Пути", Kind::FileList, &[]).unwrap();
        set_value(&conn, "t1", &field.id, &serde_json::json!(["/tmp/a.txt"])).unwrap();

        remove(&conn, &field.id).unwrap();
        assert!(list(&conn).unwrap().iter().all(|f| f.id != field.id));
        assert_eq!(removed_with_values(&conn).unwrap().len(), 1);

        let back = restore(&conn, &field.id).unwrap();
        assert!(back.enabled);
        assert_eq!(
            values(&conn, "t1").unwrap()[&field.id],
            serde_json::json!(["/tmp/a.txt"]),
        );
    }

    #[test]
    fn built_in_fields_are_the_apps_to_keep() {
        let conn = db();
        let priority = list(&conn).unwrap().into_iter().find(|f| f.key == "priority").unwrap();

        assert!(remove(&conn, &priority.id).is_err());
        assert!(update(&conn, &priority.id, Some("Важность"), None, None).is_err());
        // Switching off and reordering, though, are exactly what the list is for.
        assert!(!update(&conn, &priority.id, None, Some(false), None).unwrap().enabled);
    }

    #[test]
    fn a_value_has_to_be_what_the_field_says_it_is() {
        assert_eq!(
            coerce(Kind::Number, &serde_json::json!("2,5"), &[]).unwrap(),
            serde_json::json!(2.5),
        );
        assert!(coerce(Kind::Number, &serde_json::json!("скоро"), &[]).is_err());
        assert!(coerce(Kind::Date, &serde_json::json!("завтра"), &[]).is_err());
        assert_eq!(
            coerce(Kind::Date, &serde_json::json!("2026-09-16"), &[]).unwrap(),
            serde_json::json!("2026-09-16"),
        );
        assert!(coerce(Kind::Select, &serde_json::json!("жёлтый"), &["красный".into()]).is_err());
        // A single link where a list is expected is a list of one, not an error.
        assert_eq!(
            coerce(Kind::UrlList, &serde_json::json!("https://a.ru"), &[]).unwrap(),
            serde_json::json!(["https://a.ru"]),
        );
    }

    #[test]
    fn emptying_a_field_removes_the_row_rather_than_storing_nothing() {
        let conn = db();
        let field = create(&conn, "Заметка", Kind::Text, &[]).unwrap();
        set_value(&conn, "t1", &field.id, &serde_json::json!("что-то")).unwrap();
        set_value(&conn, "t1", &field.id, &serde_json::json!("")).unwrap();

        assert!(values(&conn, "t1").unwrap().as_object().unwrap().is_empty());
    }

    #[test]
    fn the_order_is_whatever_the_user_dragged_it_into() {
        let conn = db();
        let fields = list(&conn).unwrap();
        let reversed: Vec<String> = fields.iter().rev().map(|f| f.id.clone()).collect();

        reorder(&conn, &reversed).unwrap();

        assert_eq!(
            list(&conn).unwrap().first().unwrap().key,
            fields.last().unwrap().key,
        );
    }
}
