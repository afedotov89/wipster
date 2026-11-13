//! Durable journal below every command/AI write. No network or credentials here.
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

pub type Result<T> = std::result::Result<T, String>;
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
pub const TABLES: &[(&str, &str)] = &[
    ("project", "projects"),
    ("task", "tasks"),
    ("field", "task_fields"),
    ("value", "task_field_values"),
    ("preference", "settings"),
];

pub fn install(c: &Connection) -> Result<()> {
    c.execute_batch("CREATE TABLE IF NOT EXISTS sync_control(id INTEGER PRIMARY KEY CHECK(id=1), suppress INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0, cursor INTEGER NOT NULL DEFAULT 0, require_empty INTEGER NOT NULL DEFAULT 0);
    INSERT OR IGNORE INTO sync_control(id) VALUES(1);
    CREATE TABLE IF NOT EXISTS sync_dirty(kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(kind,id));
    CREATE TABLE IF NOT EXISTS sync_versions(kind TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(kind,id));
    CREATE TABLE IF NOT EXISTS sync_pending(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL,revisions TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_recovery(id INTEGER PRIMARY KEY, saved_at TEXT NOT NULL DEFAULT(datetime('now')), reason TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_conflicts(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_inbox(sequence INTEGER PRIMARY KEY,payload TEXT NOT NULL);") .map_err(err)?;
    for (kind, table) in TABLES {
        for (event, alias) in [("INSERT", "NEW"), ("UPDATE", "NEW"), ("DELETE", "OLD")] {
            let ident = match *kind {
                "value" => format!("{alias}.task_id || ':' || {alias}.field_id"),
                "preference" => format!("{alias}.key"),
                _ => format!("{alias}.id"),
            };
            let filter = match *kind {
                "preference" => format!(" AND {alias}.key='wip_limit'"),
                "value" => format!(" AND EXISTS(SELECT 1 FROM task_fields WHERE id={alias}.field_id AND kind!='file_list')"),
                _ => String::new(),
            };
            c.execute_batch(&format!("CREATE TRIGGER IF NOT EXISTS sync_{table}_{event} AFTER {event} ON {table}
                WHEN (SELECT suppress FROM sync_control WHERE id=1)=0 {filter} BEGIN
                UPDATE sync_control SET revision=revision+1 WHERE id=1;
                INSERT INTO sync_dirty(kind,id,revision) VALUES('{kind}',{ident},(SELECT revision FROM sync_control WHERE id=1))
                ON CONFLICT(kind,id) DO UPDATE SET revision=excluded.revision; END;")) .map_err(err)?;
        }
    }
    // A field changing from/to file_list must never leak previously stored paths.
    // Kind is immutable in today's field editor; server additionally rejects such values.
    Ok(())
}

fn columns(c: &Connection, table: &str) -> Result<Vec<String>> {
    let mut s = c
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(err)?;
    let rows = s.query_map([], |r| r.get(1)).map_err(err)?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)
}

pub fn snapshot(c: &Connection) -> Result<BTreeMap<(String, String), Value>> {
    let mut result = BTreeMap::new();
    for (kind, table) in TABLES {
        let cols = columns(c, table)?;
        let filter = match *kind {
            "preference" => " WHERE key='wip_limit'",
            "value" => " WHERE field_id IN(SELECT id FROM task_fields WHERE kind!='file_list')",
            _ => "",
        };
        let mut s = c
            .prepare(&format!("SELECT * FROM {table}{filter}"))
            .map_err(err)?;
        let mut rows = s.query([]).map_err(err)?;
        while let Some(row) = rows.next().map_err(err)? {
            let mut data = Map::new();
            for (i, name) in cols.iter().enumerate() {
                use rusqlite::types::ValueRef;
                let v = match row.get_ref(i).map_err(err)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(n) => json!(n),
                    ValueRef::Real(n) => json!(n),
                    ValueRef::Text(v) => json!(std::str::from_utf8(v).map_err(err)?),
                    ValueRef::Blob(_) => return Err("Unexpected binary column".into()),
                };
                data.insert(name.clone(), v);
            }
            if *kind == "task" {
                data.insert("return_ref".into(), Value::Null);
            }
            let id = match *kind {
                "value" => format!(
                    "{}:{}",
                    data["task_id"].as_str().ok_or("Invalid task ID")?,
                    data["field_id"].as_str().ok_or("Invalid field ID")?
                ),
                "preference" => data["key"]
                    .as_str()
                    .ok_or("Invalid preference")?
                    .to_string(),
                _ => data["id"].as_str().ok_or("Invalid entity ID")?.to_string(),
            };
            result.insert((kind.to_string(), id), Value::Object(data));
        }
    }
    Ok(result)
}

pub fn dirty_count(c: &Connection) -> Result<i64> {
    c.query_row("SELECT COUNT(*) FROM sync_dirty", [], |r| r.get(0))
        .map_err(err)
}

pub fn prepare(c: &mut Connection) -> Result<Option<Value>> {
    let tx = c.transaction().map_err(err)?;
    let pending: Option<String> = tx
        .query_row("SELECT body FROM sync_pending WHERE id=1", [], |r| r.get(0))
        .optional()
        .map_err(err)?;
    if let Some(body) = pending {
        return Ok(Some(serde_json::from_str(&body).map_err(err)?));
    }
    let mut revisions = Vec::new();
    {
        let mut s = tx
            .prepare("SELECT kind,id,revision FROM sync_dirty ORDER BY kind,id")
            .map_err(err)?;
        let rows = s
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })
            .map_err(err)?;
        for row in rows {
            let (k, id, rev) = row.map_err(err)?;
            revisions.push(json!([k, id, rev]));
        }
    }
    if revisions.is_empty() {
        return Ok(None);
    }
    if revisions.len() > 5000 {
        return Err("Too many pending entities for one atomic batch (maximum 5000). Local work is preserved.".into());
    }
    let state = snapshot(&tx)?;
    let mut operations = Vec::new();
    for r in &revisions {
        let k = r[0].as_str().unwrap();
        let id = r[1].as_str().unwrap();
        let version: i64 = tx
            .query_row(
                "SELECT version FROM sync_versions WHERE kind=?1 AND id=?2",
                params![k, id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?
            .unwrap_or(0);
        operations.push(json!({"kind":k,"id":id,"base_version":version,"data":state.get(&(k.to_string(),id.to_string())).cloned().unwrap_or(Value::Null)}));
    }
    let empty: bool = tx
        .query_row(
            "SELECT require_empty FROM sync_control WHERE id=1",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;
    let body = json!({"batch_id":uuid::Uuid::new_v4().to_string(),"operations":operations,"require_empty":empty});
    let bytes = body.to_string();
    if bytes.len() > 7 * 1024 * 1024 {
        return Err("Atomic batch exceeds 7 MiB. Local work is preserved.".into());
    }
    tx.execute(
        "INSERT INTO sync_pending(id,body,revisions) VALUES(1,?1,?2)",
        params![bytes, Value::Array(revisions).to_string()],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(Some(body))
}

pub fn acknowledge(c: &mut Connection, response: &Value) -> Result<()> {
    let tx = c.transaction().map_err(err)?;
    let revisions: String = tx
        .query_row("SELECT revisions FROM sync_pending WHERE id=1", [], |r| {
            r.get(0)
        })
        .map_err(err)?;
    let revisions: Vec<Value> = serde_json::from_str(&revisions).map_err(err)?;
    let pending: String = tx
        .query_row("SELECT body FROM sync_pending WHERE id=1", [], |r| r.get(0))
        .map_err(err)?;
    let pending: Value = serde_json::from_str(&pending).map_err(err)?;
    let operations = pending["operations"]
        .as_array()
        .ok_or("Invalid pending batch")?;
    let changes = response["changes"]
        .as_array()
        .ok_or("Invalid sync acknowledgement")?;
    if response["batch_id"] != pending["batch_id"] || changes.len() != operations.len() {
        return Err("Incomplete or mismatched sync acknowledgement; outbox retained".into());
    }
    let mut acknowledged = std::collections::BTreeSet::new();
    for change in changes {
        let key = (
            change["kind"]
                .as_str()
                .ok_or("Invalid acknowledgement kind")?,
            change["id"].as_str().ok_or("Invalid acknowledgement id")?,
        );
        let op = operations
            .iter()
            .find(|op| op["kind"] == key.0 && op["id"] == key.1)
            .ok_or("Unexpected acknowledged entity")?;
        if !acknowledged.insert(key)
            || change["version"].as_i64() != op["base_version"].as_i64().map(|v| v + 1)
        {
            return Err("Invalid acknowledged version; outbox retained".into());
        }
        set_version(&tx, change)?;
    }
    for r in revisions {
        tx.execute(
            "DELETE FROM sync_dirty WHERE kind=?1 AND id=?2 AND revision=?3",
            params![r[0].as_str(), r[1].as_str(), r[2].as_i64()],
        )
        .map_err(err)?;
    }
    tx.execute_batch(
        "DELETE FROM sync_pending; UPDATE sync_control SET require_empty=0 WHERE id=1;",
    )
    .map_err(err)?;
    tx.commit().map_err(err)
}

fn set_version(c: &Connection, ch: &Value) -> Result<()> {
    c.execute("INSERT INTO sync_versions(kind,id,version) VALUES(?1,?2,?3) ON CONFLICT(kind,id) DO UPDATE SET version=excluded.version",params![ch["kind"].as_str(),ch["id"].as_str(),ch["version"].as_i64()]).map_err(err)?;
    Ok(())
}

pub fn stage(c: &Connection, response: &Value) -> Result<()> {
    // Cursor advances only in the transaction that applies the complete inbox.
    for ch in response["changes"].as_array().ok_or("Invalid sync feed")? {
        c.execute(
            "INSERT OR REPLACE INTO sync_inbox(sequence,payload) VALUES(?1,?2)",
            params![ch["sequence"].as_i64(), ch.to_string()],
        )
        .map_err(err)?;
    }
    Ok(())
}

#[cfg(test)]
pub fn cursor(c: &Connection) -> Result<i64> {
    c.query_row("SELECT cursor FROM sync_control WHERE id=1", [], |r| {
        r.get(0)
    })
    .map_err(err)
}

pub fn apply_inbox(c: &mut Connection, cursor: i64) -> Result<bool> {
    let tx = c.transaction().map_err(err)?;
    if dirty_count(&tx)? > 0 {
        return Ok(false);
    }
    tx.execute_batch(
        "PRAGMA defer_foreign_keys=ON; UPDATE sync_control SET suppress=1 WHERE id=1;",
    )
    .map_err(err)?;
    let mut changed = false;
    let mut recovered = false;
    {
        // SQLite stages/sorts the feed on disk; hold only one latest entity in
        // Rust, even when many byte-bounded pages form a large atomic graph.
        let mut statement=tx.prepare("SELECT payload FROM sync_inbox WHERE sequence IN (
            SELECT MAX(sequence) FROM sync_inbox GROUP BY json_extract(payload,'$.kind'),json_extract(payload,'$.id')
        ) ORDER BY json_extract(payload,'$.kind'),json_extract(payload,'$.id')").map_err(err)?;
        let mut rows = statement.query([]).map_err(err)?;
        while let Some(row) = rows.next().map_err(err)? {
            let ch: Value =
                serde_json::from_str(&row.get::<_, String>(0).map_err(err)?).map_err(err)?;
            let version: i64 = tx
                .query_row(
                    "SELECT version FROM sync_versions WHERE kind=?1 AND id=?2",
                    params![ch["kind"].as_str(), ch["id"].as_str()],
                    |r| r.get(0),
                )
                .optional()
                .map_err(err)?
                .unwrap_or(0);
            if ch["version"].as_i64().ok_or("Invalid version")? <= version {
                continue;
            }
            if ch["data"].is_null() && !recovered {
                let recovery = local_only_recovery(&tx)?;
                tx.execute("INSERT INTO sync_recovery(reason,payload) VALUES('local file references before remote deletion',?1)",[recovery.to_string()]).map_err(err)?;
                recovered = true;
            }
            apply_entity(&tx, &ch)?;
            set_version(&tx, &ch)?;
            changed = true;
        }
    }
    tx.execute(
        "UPDATE sync_control SET suppress=0,cursor=?1 WHERE id=1",
        [cursor],
    )
    .map_err(err)?;
    tx.execute("DELETE FROM sync_inbox", []).map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(changed)
}

pub fn apply_entity(c: &Connection, ch: &Value) -> Result<()> {
    let kind = ch["kind"].as_str().ok_or("Invalid kind")?;
    let table = TABLES
        .iter()
        .find(|(k, _)| *k == kind)
        .ok_or("Invalid kind")?
        .1;
    let id = ch["id"].as_str().ok_or("Invalid id")?;
    if kind == "preference"
        && (id != "wip_limit" || (!ch["data"].is_null() && ch["data"]["key"] != "wip_limit"))
    {
        return Err("Cloud attempted to modify a device-only setting".into());
    }
    if kind == "value" {
        let field = if ch["data"].is_null() {
            id.split_once(':').ok_or("Invalid value id")?.1
        } else {
            ch["data"]["field_id"].as_str().ok_or("Invalid field id")?
        };
        let file_kind: Option<String> = c
            .query_row("SELECT kind FROM task_fields WHERE id=?1", [field], |r| {
                r.get(0)
            })
            .optional()
            .map_err(err)?;
        if file_kind.as_deref() == Some("file_list") {
            return Err("Cloud attempted to modify local file values".into());
        }
    }
    if ch["data"].is_null() {
        // Preserve locally captured context even after the corresponding cloud task is deleted.
        if kind == "task" {
            c.execute(
                "UPDATE context_snapshots SET task_id=NULL WHERE task_id=?1",
                [id],
            )
            .map_err(err)?;
        }
        if kind == "value" {
            let (task, field) = id.split_once(':').ok_or("Invalid value id")?;
            c.execute(
                "DELETE FROM task_field_values WHERE task_id=?1 AND field_id=?2",
                params![task, field],
            )
            .map_err(err)?;
        } else {
            let key = if kind == "preference" { "key" } else { "id" };
            c.execute(&format!("DELETE FROM {table} WHERE {key}=?1"), [id])
                .map_err(err)?;
        }
    } else {
        let mut data = ch["data"].as_object().ok_or("Invalid data")?.clone();
        if kind == "task" {
            let local: Option<String> = c
                .query_row("SELECT return_ref FROM tasks WHERE id=?1", [id], |r| {
                    r.get(0)
                })
                .optional()
                .map_err(err)?
                .flatten();
            data.insert(
                "return_ref".into(),
                local.map(Value::String).unwrap_or(Value::Null),
            );
        }
        let cols = columns(c, table)?;
        if data.len() != cols.len() || cols.iter().any(|k| !data.contains_key(k)) {
            return Err("Cloud schema differs from this app; update Wipster".into());
        }
        let quoted: Vec<String> = cols.iter().map(|k| format!("\"{k}\"")).collect();
        let values: Vec<rusqlite::types::Value> = cols
            .iter()
            .map(|k| match &data[k] {
                Value::Null => Ok(rusqlite::types::Value::Null),
                Value::String(s) => Ok(rusqlite::types::Value::Text(s.clone())),
                Value::Number(n) => n
                    .as_i64()
                    .map(rusqlite::types::Value::Integer)
                    .ok_or("Invalid integer".to_string()),
                _ => Err("Invalid column value".into()),
            })
            .collect::<Result<_>>()?;
        let placeholders = vec!["?"; cols.len()].join(",");
        let conflict = if kind == "value" {
            "task_id,field_id"
        } else if kind == "preference" {
            "key"
        } else {
            "id"
        };
        let updates = quoted
            .iter()
            .map(|k| format!("{k}=excluded.{k}"))
            .collect::<Vec<_>>()
            .join(",");
        c.execute(&format!("INSERT INTO {table}({}) VALUES({placeholders}) ON CONFLICT({conflict}) DO UPDATE SET {updates}",quoted.join(",")),rusqlite::params_from_iter(values)).map_err(err)?;
    }
    Ok(())
}

/// Copy only the reviewed cloud projection. Source is never changed.
pub fn import_local(source: &Connection, target: &mut Connection) -> Result<()> {
    let state = snapshot(source)?;
    let tx = target.transaction().map_err(err)?;
    tx.execute_batch("UPDATE sync_control SET suppress=1 WHERE id=1; PRAGMA defer_foreign_keys=ON; DELETE FROM task_fields;").map_err(err)?;
    for ((kind, id), data) in state {
        apply_entity(&tx, &json!({"kind":kind,"id":id,"data":data}))?;
    }
    tx.execute_batch("UPDATE sync_control SET suppress=0 WHERE id=1")
        .map_err(err)?;
    mark_all(&tx, true)?;
    tx.commit().map_err(err)
}

pub fn mark_all(c: &Connection, require_empty: bool) -> Result<()> {
    let state = snapshot(c)?;
    for (kind, id) in state.keys() {
        c.execute_batch("UPDATE sync_control SET revision=revision+1 WHERE id=1")
            .map_err(err)?;
        c.execute("INSERT OR REPLACE INTO sync_dirty(kind,id,revision) VALUES(?1,?2,(SELECT revision FROM sync_control WHERE id=1))",params![kind,id]).map_err(err)?;
    }
    c.execute(
        "UPDATE sync_control SET require_empty=?1 WHERE id=1",
        [require_empty],
    )
    .map_err(err)?;
    Ok(())
}

pub fn conflict(c: &Connection, response: &Value) -> Result<()> {
    c.execute(
        "INSERT OR REPLACE INTO sync_conflicts(id,payload) VALUES(1,?1)",
        [response.to_string()],
    )
    .map_err(err)?;
    Ok(())
}

fn local_only_recovery(c: &Connection) -> Result<Value> {
    let mut attachments = Vec::new();
    let mut s=c.prepare("SELECT task_id,field_id,value,updated_at FROM task_field_values WHERE field_id IN(SELECT id FROM task_fields WHERE kind='file_list')").map_err(err)?;
    for row in s.query_map([],|r| Ok(json!({"task_id":r.get::<_,String>(0)?,"field_id":r.get::<_,String>(1)?,"value":r.get::<_,String>(2)?,"updated_at":r.get::<_,String>(3)?}))).map_err(err)? {attachments.push(row.map_err(err)?);}
    let mut refs = Vec::new();
    let mut s = c
        .prepare("SELECT id,return_ref FROM tasks WHERE return_ref IS NOT NULL")
        .map_err(err)?;
    for row in s
        .query_map([], |r| {
            Ok(json!({"task_id":r.get::<_,String>(0)?,"return_ref":r.get::<_,String>(1)?}))
        })
        .map_err(err)?
    {
        refs.push(row.map_err(err)?);
    }
    Ok(json!({"file_values":attachments,"return_refs":refs}))
}

pub fn resolve(c: &mut Connection, keep_local: bool) -> Result<()> {
    let tx = c.transaction().map_err(err)?;
    let payload: Option<String> = tx
        .query_row("SELECT payload FROM sync_conflicts WHERE id=1", [], |r| {
            r.get(0)
        })
        .optional()
        .map_err(err)?;
    let response: Value = payload
        .map(|p| serde_json::from_str(&p).map_err(err))
        .transpose()?
        .unwrap_or(Value::Null);
    let pending: Option<String> = tx
        .query_row("SELECT body FROM sync_pending WHERE id=1", [], |r| r.get(0))
        .optional()
        .map_err(err)?;
    if let Some(pending) = pending {
        tx.execute(
            "INSERT INTO sync_recovery(reason,payload) VALUES('explicit conflict resolution',?1)",
            [pending],
        )
        .map_err(err)?;
    }
    if keep_local {
        if response["error"] != "conflict" {
            return Err("This batch cannot be rebased. Use cloud to discard this import.".into());
        }
        for ch in response["conflicts"].as_array().ok_or("Invalid conflict")? {
            set_version(&tx, ch)?;
        }
    } else {
        // Preserve the latest local edits, including those made after the frozen outbox.
        let local: Vec<Value> = snapshot(&tx)?
            .into_iter()
            .map(|((k, id), d)| json!({"kind":k,"id":id,"data":d}))
            .collect();
        let recovery = json!({"entities":local,"local_only":local_only_recovery(&tx)?});
        tx.execute("INSERT INTO sync_recovery(reason,payload) VALUES('latest local snapshot before use cloud',?1)",[recovery.to_string()]).map_err(err)?;
        tx.execute_batch("UPDATE sync_control SET suppress=1 WHERE id=1; PRAGMA defer_foreign_keys=ON;
            UPDATE context_snapshots SET task_id=NULL;
            DELETE FROM task_field_values; DELETE FROM tasks; DELETE FROM projects; DELETE FROM task_fields;
            DELETE FROM settings WHERE key='wip_limit'; DELETE FROM sync_dirty; DELETE FROM sync_versions; DELETE FROM sync_inbox;
            UPDATE sync_control SET cursor=0,require_empty=0 WHERE id=1;").map_err(err)?;
        // Keep the app usable even if the cloud account is entirely empty.
        // Seed the same built-ins as a fresh workspace without generating uploads;
        // the authoritative feed will replace any cloud definitions.
        let defaults = Connection::open_in_memory().map_err(err)?;
        crate::db::migrations::run(&defaults).map_err(err)?;
        for ((kind, id), data) in snapshot(&defaults)? {
            apply_entity(&tx, &json!({"kind":kind,"id":id,"data":data}))?;
        }
        tx.execute_batch("UPDATE sync_control SET suppress=0 WHERE id=1")
            .map_err(err)?;
    }
    tx.execute_batch("DELETE FROM sync_pending; DELETE FROM sync_conflicts;")
        .map_err(err)?;
    tx.commit().map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connection::init_test_db;

    fn project(c: &Connection, id: &str) {
        c.execute("INSERT INTO projects(id,name) VALUES(?1,?1)", [id])
            .unwrap();
    }
    fn ack(c: &mut Connection, body: &Value) {
        let changes: Vec<Value> = body["operations"].as_array().unwrap().iter().map(|o|json!({"kind":o["kind"],"id":o["id"],"version":o["base_version"].as_i64().unwrap()+1,"data":o["data"]})).collect();
        acknowledge(c, &json!({"batch_id":body["batch_id"],"changes":changes})).unwrap();
    }

    #[test]
    fn frozen_retry_survives_reopen_and_ack_preserves_later_edits() {
        let file = tempfile::NamedTempFile::new().unwrap();
        let mut c = Connection::open(file.path()).unwrap();
        crate::db::migrations::run(&c).unwrap();
        project(&c, "p");
        let body = prepare(&mut c).unwrap().unwrap();
        drop(c);
        let mut c = Connection::open(file.path()).unwrap();
        assert_eq!(prepare(&mut c).unwrap().unwrap(), body);
        c.execute(
            "UPDATE projects SET name='edited while sending' WHERE id='p'",
            [],
        )
        .unwrap();
        ack(&mut c, &body);
        assert_eq!(dirty_count(&c).unwrap(), 1);
        let next = prepare(&mut c).unwrap().unwrap();
        assert_eq!(next["operations"][0]["base_version"], 1);
        assert_eq!(
            next["operations"][0]["data"]["name"],
            "edited while sending"
        );
        assert_ne!(next["batch_id"], body["batch_id"]);
    }

    #[test]
    fn rust_tools_undo_and_cascades_enter_the_same_journal() {
        let mut c = init_test_db();
        // This is the same tool used by the Rust assistant, not a frontend wrapper.
        crate::services::tools::tasks::create_task(&c, &json!({"title":"AI work"})).unwrap();
        assert_eq!(dirty_count(&c).unwrap(), 1);
        let body = prepare(&mut c).unwrap().unwrap();
        ack(&mut c, &body);
        let entries = crate::services::undo_redo::get_undo_batch(&c).unwrap();
        for entry in entries {
            crate::services::undo_redo::apply_undo(&c, &entry).unwrap();
        }
        let body = prepare(&mut c).unwrap().unwrap();
        assert!(body["operations"][0]["data"].is_null());
        assert_eq!(body["operations"][0]["base_version"], 1);
    }

    #[test]
    fn secrets_file_values_and_captured_context_never_enter_outbox() {
        let mut c = init_test_db();
        c.execute(
            "INSERT INTO tasks(id,title,return_ref) VALUES('t','work','private machine context')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO task_fields(id,key,kind) VALUES('files','files','file_list')",
            [],
        )
        .unwrap();
        c.execute("INSERT INTO task_field_values(task_id,field_id,value) VALUES('t','files','[\"/private/file\"]')",[]).unwrap();
        c.execute(
            "INSERT INTO settings(key,value) VALUES('llm_api_key','must-not-upload')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO settings(key,value) VALUES('wip_limit','4')",
            [],
        )
        .unwrap();
        let body = prepare(&mut c).unwrap().unwrap().to_string();
        assert!(!body.contains("must-not-upload"));
        assert!(!body.contains("private machine"));
        assert!(!body.contains("/private/file"));
        assert!(body.contains("wip_limit"));
    }

    #[test]
    fn pages_apply_together_with_forward_references_and_no_echo() {
        let source = init_test_db();
        project(&source, "parent");
        project(&source, "child");
        source
            .execute(
                "UPDATE projects SET parent_id='parent' WHERE id='child'",
                [],
            )
            .unwrap();
        let state = snapshot(&source).unwrap();
        let mut target = init_test_db();
        let child = json!({"kind":"project","id":"child","version":1,"sequence":1,"data":state[&("project".into(),"child".into())]});
        let parent = json!({"kind":"project","id":"parent","version":1,"sequence":2,"data":state[&("project".into(),"parent".into())]});
        stage(&target, &json!({"changes":[child]})).unwrap();
        assert_eq!(
            target
                .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(cursor(&target).unwrap(), 0);
        stage(&target, &json!({"changes":[parent]})).unwrap();
        assert!(apply_inbox(&mut target, 2).unwrap());
        assert_eq!(dirty_count(&target).unwrap(), 0);
        assert_eq!(cursor(&target).unwrap(), 2);
        // Same feed replay is harmless and does not replace subsequent acknowledged work.
        stage(&target, &json!({"changes":[child]})).unwrap();
        apply_inbox(&mut target, 2).unwrap();
        assert_eq!(
            target
                .query_row("SELECT parent_id FROM projects WHERE id='child'", [], |r| r
                    .get::<_, String>(0))
                .unwrap(),
            "parent"
        );
    }

    #[test]
    fn incoming_changes_wait_for_offline_edits_and_conflict_is_explicit() {
        let mut c = init_test_db();
        project(&c, "p");
        let body = prepare(&mut c).unwrap().unwrap();
        let mut data = body["operations"][0]["data"].clone();
        data["name"] = json!("other device");
        let remote = json!({"kind":"project","id":"p","version":4,"sequence":4,"data":data});
        stage(&c, &json!({"changes":[remote]})).unwrap();
        assert!(!apply_inbox(&mut c, 4).unwrap());
        assert_eq!(cursor(&c).unwrap(), 0);
        conflict(&c, &json!({"error":"conflict","conflicts":[remote]})).unwrap();
        c.execute(
            "UPDATE projects SET name='newest local edit' WHERE id='p'",
            [],
        )
        .unwrap();
        resolve(&mut c, true).unwrap();
        let rebased = prepare(&mut c).unwrap().unwrap();
        assert_eq!(rebased["operations"][0]["base_version"], 4);
        assert_eq!(
            rebased["operations"][0]["data"]["name"],
            "newest local edit"
        );
        assert_eq!(
            c.query_row("SELECT COUNT(*) FROM sync_recovery", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn use_cloud_retains_recovery_and_device_secrets_then_downloads_fresh() {
        let mut c = init_test_db();
        project(&c, "p");
        prepare(&mut c).unwrap();
        c.execute(
            "INSERT INTO settings(key,value) VALUES('tracker_token','device-local')",
            [],
        )
        .unwrap();
        conflict(&c, &json!({"error":"conflict","conflicts":[]})).unwrap();
        c.execute(
            "UPDATE projects SET name='late unsent edit' WHERE id='p'",
            [],
        )
        .unwrap();
        resolve(&mut c, false).unwrap();
        assert_eq!(dirty_count(&c).unwrap(), 0);
        assert_eq!(cursor(&c).unwrap(), 0);
        assert!(c
            .query_row(
                "SELECT payload FROM sync_recovery WHERE reason LIKE 'latest%'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap()
            .contains("late unsent edit"));
        assert_eq!(
            c.query_row(
                "SELECT value FROM settings WHERE key='tracker_token'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "device-local"
        );
    }

    #[test]
    fn failed_remote_graph_is_atomic_and_local_context_survives_deletion() {
        let mut c = init_test_db();
        project(&c, "p");
        let b = prepare(&mut c).unwrap().unwrap();
        ack(&mut c, &b);
        c.execute("INSERT INTO tasks(id,title,project_id,return_ref) VALUES('t','work','p','private context')",[]).unwrap();
        c.execute(
            "INSERT INTO context_snapshots(id,task_id,note) VALUES('ctx','t','keep this')",
            [],
        )
        .unwrap();
        let b = prepare(&mut c).unwrap().unwrap();
        ack(&mut c, &b);
        let deletion = json!({"kind":"task","id":"t","version":2,"sequence":1,"data":null});
        stage(&c, &json!({"changes":[deletion]})).unwrap();
        apply_inbox(&mut c, 1).unwrap();
        assert_eq!(
            c.query_row(
                "SELECT note FROM context_snapshots WHERE id='ctx'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "keep this"
        );
        assert_eq!(dirty_count(&c).unwrap(), 0);
        let mut d = snapshot(&c).unwrap()[&("project".into(), "p".into())].clone();
        d["parent_id"] = json!("missing");
        stage(
            &c,
            &json!({"changes":[{"kind":"project","id":"p","version":2,"sequence":2,"data":d}]}),
        )
        .unwrap();
        assert!(apply_inbox(&mut c, 2).is_err());
        assert_eq!(cursor(&c).unwrap(), 1);
        assert_eq!(
            c.query_row("SELECT suppress FROM sync_control", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn rejected_import_can_be_abandoned_without_losing_file_recovery() {
        let mut c = init_test_db();
        c.execute(
            "INSERT INTO tasks(id,title,return_ref) VALUES('t','local work','local context')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO task_fields(id,key,kind) VALUES('files','files','file_list')",
            [],
        )
        .unwrap();
        c.execute("INSERT INTO task_field_values(task_id,field_id,value) VALUES('t','files','[\"/private/file\"]')",[]).unwrap();
        resolve(&mut c, false).unwrap();
        assert_eq!(dirty_count(&c).unwrap(), 0);
        assert_eq!(
            c.query_row(
                "SELECT COUNT(*) FROM task_fields WHERE builtin=1",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            10
        );
        let recovery: String = c
            .query_row(
                "SELECT payload FROM sync_recovery WHERE reason LIKE 'latest%'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(recovery.contains("/private/file"));
        assert!(recovery.contains("local context"));
    }
    #[test]
    fn import_preserves_original_ids_values_and_original_private_data() {
        let source = init_test_db();
        project(&source, "p");
        source.execute("INSERT INTO tasks(id,title,project_id,status,archived_at,position,tags,checklist,return_ref) VALUES('t','work','p','done','yesterday',7,'[\"tag\"]','[]','private context')",[]).unwrap();
        source
            .execute(
                "INSERT INTO task_fields(id,key,kind) VALUES('custom','custom','number')",
                [],
            )
            .unwrap();
        source
            .execute(
                "INSERT INTO task_field_values(task_id,field_id,value) VALUES('t','custom','42')",
                [],
            )
            .unwrap();
        source.execute("INSERT INTO settings(key,value) VALUES('llm_api_key','private-key'),('wip_limit','5')",[]).unwrap();
        source
            .execute(
                "INSERT INTO context_snapshots(id,task_id,note) VALUES('ctx','t','private note')",
                [],
            )
            .unwrap();
        let mut target = init_test_db();
        import_local(&source, &mut target).unwrap();
        assert_eq!(snapshot(&source).unwrap(), snapshot(&target).unwrap());
        assert_eq!(
            source
                .query_row("SELECT return_ref FROM tasks WHERE id='t'", [], |r| r
                    .get::<_, String>(0))
                .unwrap(),
            "private context"
        );
        assert_eq!(
            source
                .query_row("SELECT COUNT(*) FROM context_snapshots", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            target
                .query_row(
                    "SELECT COUNT(*) FROM settings WHERE key='llm_api_key'",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        let pending = prepare(&mut target).unwrap().unwrap();
        assert_eq!(pending["require_empty"], true);
        assert!(pending["operations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|o| o["kind"] == "value" && o["id"] == "t:custom" && o["data"]["value"] == "42"));
    }

    #[test]
    fn migration_from_existing_v17_adds_journal_without_import_or_data_loss() {
        let c = init_test_db();
        project(&c, "existing");
        c.execute(
            "INSERT INTO settings(key,value) VALUES('llm_api_key','keep local')",
            [],
        )
        .unwrap();
        let triggers: Vec<String> = {
            let mut s = c
                .prepare(
                    "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'sync_%'",
                )
                .unwrap();
            let r = s.query_map([], |r| r.get(0)).unwrap();
            r.collect::<std::result::Result<_, _>>().unwrap()
        };
        for t in triggers {
            c.execute_batch(&format!("DROP TRIGGER {t}")).unwrap();
        }
        c.execute_batch("DELETE FROM schema_version WHERE version=18; DROP TABLE sync_control; DROP TABLE sync_dirty; DROP TABLE sync_versions; DROP TABLE sync_pending; DROP TABLE sync_recovery; DROP TABLE sync_conflicts; DROP TABLE sync_inbox;").unwrap();
        let before = snapshot(&c).unwrap();
        crate::db::migrations::run(&c).unwrap();
        assert_eq!(snapshot(&c).unwrap(), before);
        assert_eq!(dirty_count(&c).unwrap(), 0);
        assert_eq!(
            c.query_row(
                "SELECT value FROM settings WHERE key='llm_api_key'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "keep local"
        );
        c.execute(
            "UPDATE projects SET name='changed after upgrade' WHERE id='existing'",
            [],
        )
        .unwrap();
        assert_eq!(dirty_count(&c).unwrap(), 1);
    }
    #[test]
    fn acknowledged_echoes_advance_cursor_without_reporting_or_applying_changes() {
        let mut c = init_test_db();
        project(&c, "p");
        let body = prepare(&mut c).unwrap().unwrap();
        ack(&mut c, &body);
        let ch = json!({"kind":"project","id":"p","version":1,"sequence":1,"data":body["operations"][0]["data"]});
        stage(&c, &json!({"changes":[ch]})).unwrap();
        assert!(!apply_inbox(&mut c, 1).unwrap());
        assert_eq!(cursor(&c).unwrap(), 1);
        assert_eq!(dirty_count(&c).unwrap(), 0);
        assert_eq!(
            c.query_row("SELECT COUNT(*) FROM sync_recovery", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn compact_ack_must_identify_the_complete_frozen_batch_before_clearing_work() {
        let mut c = init_test_db();
        project(&c, "p");
        project(&c, "q");
        let body = prepare(&mut c).unwrap().unwrap();
        let one = json!({"kind":"project","id":"p","version":1});
        assert!(acknowledge(
            &mut c,
            &json!({"batch_id":body["batch_id"],"changes":[one]})
        )
        .is_err());
        assert!(acknowledge(
            &mut c,
            &json!({"batch_id":body["batch_id"],"changes":[one,one]})
        )
        .is_err());
        assert_eq!(dirty_count(&c).unwrap(), 2);
        assert_eq!(prepare(&mut c).unwrap().unwrap(), body);
        ack(&mut c, &body);
        assert_eq!(dirty_count(&c).unwrap(), 0);
    }
}
