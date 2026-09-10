//! What the assistant remembers between conversations.

use rusqlite::Connection;
use serde_json::{json, Value};

use super::{Availability, Danger, Handler, Tool};

pub fn remember(conn: &Connection, args: &Value) -> Result<String, String> {
    let fact = args["fact"].as_str().ok_or("missing fact")?;
    let existing: String = conn.query_row(
        "SELECT value FROM settings WHERE key = 'agent_memory'",
        [], |r| r.get(0),
    ).unwrap_or_default();
    let new_memory = if existing.is_empty() {
        fact.to_string()
    } else {
        format!("{}\n{}", existing, fact)
    };
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('agent_memory', ?1)",
        [&new_memory],
    ).map_err(|e| e.to_string())?;
    Ok(format!("Remembered: {}", fact))
}

pub fn tools() -> Vec<Tool> {
    vec![
        Tool {
            name: "remember",
            summary: "Save a fact about the user to persistent memory",
            keywords: &["запомни", "память", "remember", "memory", "note about me"],
            availability: Availability::OnDemand,
            danger: Danger::Safe,
            params: || json!({
                "type": "object",
                "properties": { "fact": { "type": "string" } },
                "required": ["fact"]
            }),
            handler: Handler::Db(remember),
        },
    ]
}
