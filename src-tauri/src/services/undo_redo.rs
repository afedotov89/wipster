use rusqlite::Connection;
use uuid::Uuid;

use crate::models::changelog::ChangeLogEntry;

pub fn record_change(
    conn: &Connection,
    action: &str,
    entity_type: &str,
    entity_id: &str,
    old_value: Option<&str>,
    new_value: Option<&str>,
    batch_id: Option<&str>,
) -> Result<String, rusqlite::Error> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO changelog (id, actor, action, entity_type, entity_id, old_value, new_value, batch_id) \
         VALUES (?1, 'user', ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![id, action, entity_type, entity_id, old_value, new_value, batch_id],
    )?;
    Ok(id)
}

pub fn get_last_undoable(conn: &Connection) -> Result<Option<ChangeLogEntry>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, created_at, actor, action, entity_type, entity_id, \
         old_value, new_value, undone, batch_id \
         FROM changelog WHERE undone = 0 ORDER BY created_at DESC LIMIT 1",
    )?;

    let entry = stmt.query_row([], |row| {
        Ok(ChangeLogEntry {
            id: row.get(0)?,
            created_at: row.get(1)?,
            actor: row.get(2)?,
            action: row.get(3)?,
            entity_type: row.get(4)?,
            entity_id: row.get(5)?,
            old_value: row.get(6)?,
            new_value: row.get(7)?,
            undone: row.get::<_, i32>(8)? != 0,
            batch_id: row.get(9)?,
        })
    });

    match entry {
        Ok(e) => Ok(Some(e)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn get_last_redoable(conn: &Connection) -> Result<Option<ChangeLogEntry>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, created_at, actor, action, entity_type, entity_id, \
         old_value, new_value, undone, batch_id \
         FROM changelog WHERE undone = 1 ORDER BY created_at DESC LIMIT 1",
    )?;

    let entry = stmt.query_row([], |row| {
        Ok(ChangeLogEntry {
            id: row.get(0)?,
            created_at: row.get(1)?,
            actor: row.get(2)?,
            action: row.get(3)?,
            entity_type: row.get(4)?,
            entity_id: row.get(5)?,
            old_value: row.get(6)?,
            new_value: row.get(7)?,
            undone: row.get::<_, i32>(8)? != 0,
            batch_id: row.get(9)?,
        })
    });

    match entry {
        Ok(e) => Ok(Some(e)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn mark_undone(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    conn.execute("UPDATE changelog SET undone = 1 WHERE id = ?1", [id])?;
    Ok(())
}

pub fn mark_redone(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    conn.execute("UPDATE changelog SET undone = 0 WHERE id = ?1", [id])?;
    Ok(())
}

pub fn apply_undo(conn: &Connection, entry: &ChangeLogEntry) -> Result<(), String> {
    match entry.action.as_str() {
        "create" => {
            conn.execute(
                &format!("DELETE FROM {}s WHERE id = ?1", entry.entity_type),
                [&entry.entity_id],
            )
            .map_err(|e| e.to_string())?;
        }
        "delete" => {
            let old_val = entry
                .old_value
                .as_ref()
                .ok_or("No old_value for delete undo")?;
            restore_entity(conn, &entry.entity_type, old_val)?;
        }
        "update" => {
            let old_val = entry
                .old_value
                .as_ref()
                .ok_or("No old_value for update undo")?;
            restore_entity(conn, &entry.entity_type, old_val)?;
        }
        _ => return Err(format!("Unknown action: {}", entry.action)),
    }

    mark_undone(conn, &entry.id).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn apply_redo(conn: &Connection, entry: &ChangeLogEntry) -> Result<(), String> {
    match entry.action.as_str() {
        "create" => {
            let new_val = entry
                .new_value
                .as_ref()
                .ok_or("No new_value for create redo")?;
            restore_entity(conn, &entry.entity_type, new_val)?;
        }
        "delete" => {
            conn.execute(
                &format!("DELETE FROM {}s WHERE id = ?1", entry.entity_type),
                [&entry.entity_id],
            )
            .map_err(|e| e.to_string())?;
        }
        "update" => {
            let new_val = entry
                .new_value
                .as_ref()
                .ok_or("No new_value for update redo")?;
            restore_entity(conn, &entry.entity_type, new_val)?;
        }
        _ => return Err(format!("Unknown action: {}", entry.action)),
    }

    mark_redone(conn, &entry.id).map_err(|e| e.to_string())?;
    Ok(())
}

fn restore_entity(conn: &Connection, entity_type: &str, json_value: &str) -> Result<(), String> {
    match entity_type {
        "project" => {
            let p: serde_json::Value =
                serde_json::from_str(json_value).map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT OR REPLACE INTO projects (id, name, \"order\", created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![
                    p["id"].as_str().unwrap_or_default(),
                    p["name"].as_str().unwrap_or_default(),
                    p["order"].as_i64().unwrap_or(0),
                    p["created_at"].as_str().unwrap_or_default(),
                    p["updated_at"].as_str().unwrap_or_default(),
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        "task" => {
            let t: serde_json::Value =
                serde_json::from_str(json_value).map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT OR REPLACE INTO tasks \
                 (id, title, project_id, status, priority, due, estimate, tags, \
                  dod, checklist, next_step, return_ref, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                rusqlite::params![
                    t["id"].as_str().unwrap_or_default(),
                    t["title"].as_str().unwrap_or_default(),
                    t["project_id"].as_str(),
                    t["status"].as_str().unwrap_or("inbox"),
                    t["priority"].as_str(),
                    t["due"].as_str(),
                    t["estimate"].as_str(),
                    t["tags"].as_str().unwrap_or("[]"),
                    t["dod"].as_str(),
                    t["checklist"].as_str().unwrap_or("[]"),
                    t["next_step"].as_str(),
                    t["return_ref"].as_str(),
                    t["created_at"].as_str().unwrap_or_default(),
                    t["updated_at"].as_str().unwrap_or_default(),
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        _ => return Err(format!("Unknown entity type: {}", entity_type)),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connection::init_test_db;

    #[test]
    fn test_record_and_retrieve_change() {
        let conn = init_test_db();
        let id = record_change(&conn, "create", "project", "p1", None, Some(r#"{"id":"p1","name":"Test","order":0,"created_at":"","updated_at":""}"#), None).unwrap();
        let entry = get_last_undoable(&conn).unwrap().unwrap();
        assert_eq!(entry.id, id);
        assert_eq!(entry.action, "create");
    }

    #[test]
    fn test_undo_create() {
        let conn = init_test_db();
        conn.execute(
            "INSERT INTO projects (id, name) VALUES ('p1', 'Test')",
            [],
        )
        .unwrap();
        record_change(&conn, "create", "project", "p1", None, Some(r#"{"id":"p1","name":"Test","order":0,"created_at":"","updated_at":""}"#), None).unwrap();

        let entry = get_last_undoable(&conn).unwrap().unwrap();
        apply_undo(&conn, &entry).unwrap();

        let count: i32 = conn
            .query_row("SELECT COUNT(*) FROM projects WHERE id = 'p1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(count, 0);
    }
}
