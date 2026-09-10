//! Project tools.

use rusqlite::Connection;
use serde_json::{json, Value};

use super::{Availability, Danger, Handler, Tool};

pub fn list_projects(conn: &Connection, _args: &Value) -> Result<String, String> {
    // The parent's name comes along: without it a sub-project reads as
    // an unrelated project and the model picks the wrong one.
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, parent.name FROM projects p \
         LEFT JOIN projects parent ON p.parent_id = parent.id \
         ORDER BY p.\"order\" ASC"
    ).map_err(|e| e.to_string())?;
    let rows: Vec<String> = stmt.query_map([], |row| {
        let parent: Option<String> = row.get(2)?;
        Ok(format!(
            "- {} | {}{}",
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            parent.map(|p| format!(" (sub-project of {})", p)).unwrap_or_default(),
        ))
    }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
    if rows.is_empty() {
        Ok("No projects".to_string())
    } else {
        Ok(rows.join("\n"))
    }
}

pub fn tools() -> Vec<Tool> {
    vec![
        Tool {
            name: "create_project",
            summary: "Create a project, optionally nested inside another one",
            keywords: &["проект", "создать проект", "новый проект", "подпроект", "project", "create project", "sub-project"],
            availability: Availability::OnDemand,
            danger: Danger::Safe,
            params: || json!({
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "parent_id": { "type": "string", "description": "Nest it under this project (optional)" },
                },
                "required": ["name"]
            }),
            handler: Handler::Db(create_project),
        },
        Tool {
            name: "update_project",
            summary: "Rename a project, change its icon or colour, or nest it under another project",
            keywords: &[
                "проект", "переименовать", "цвет", "иконка", "оформление", "вложить", "подпроект",
                "project", "rename", "colour", "color", "icon", "appearance", "nest", "parent",
            ],
            availability: Availability::OnDemand,
            danger: Danger::Safe,
            params: || json!({
                "type": "object",
                "properties": {
                    "project_id": { "type": "string" },
                    "name": { "type": "string" },
                    "color": { "type": "string", "description": "Hex colour like #3498db" },
                    "icon": { "type": "string", "description": "Built-in icon key: folder, work, code, science, school, brush, music, sports, home, favorite, star, rocket, bug, build, camera, book, lightbulb, cart, fitness, palette" },
                    "parent_id": { "type": "string", "description": "Move under this project; null moves it to the top level" },
                },
                "required": ["project_id"]
            }),
            handler: Handler::Db(update_project),
        },
        Tool {
            name: "delete_project",
            summary: "Delete a project with its sub-projects; their tasks go to the archive",
            keywords: &["удалить проект", "delete project", "remove project"],
            availability: Availability::OnDemand,
            danger: Danger::Confirm,
            params: || json!({
                "type": "object",
                "properties": { "project_id": { "type": "string" } },
                "required": ["project_id"]
            }),
            handler: Handler::Db(delete_project),
        },
        Tool {
            name: "list_projects",
            summary: "List all projects with their IDs and names",
            keywords: &["проекты", "projects", "список проектов"],
            availability: Availability::Core,
            danger: Danger::Safe,
            params: || json!({ "type": "object", "properties": {} }),
            handler: Handler::Db(list_projects),
        },
    ]
}

pub fn create_project(conn: &Connection, args: &Value) -> Result<String, String> {
    let name = args["name"].as_str().ok_or("missing name")?;
    let parent_id = args["parent_id"].as_str();
    if let Some(parent) = parent_id {
        let exists: i32 = conn
            .query_row("SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1)", [parent], |r| r.get(0))
            .unwrap_or(0);
        if exists == 0 {
            return Err(format!("No project with id {}", parent));
        }
    }

    let id = uuid::Uuid::new_v4().to_string();
    let max_order: i32 = conn
        .query_row("SELECT COALESCE(MAX(\"order\"), -1) FROM projects", [], |r| r.get(0))
        .unwrap_or(-1);
    conn.execute(
        "INSERT INTO projects (id, name, \"order\", parent_id) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![id, name, max_order + 1, parent_id],
    )
    .map_err(|e| e.to_string())?;

    let snapshot = project_snapshot(conn, &id);
    super::record(conn, "create", "project", &id, None, snapshot.as_deref());
    Ok(format!("Created project {} ({})", name, id))
}

pub fn update_project(conn: &Connection, args: &Value) -> Result<String, String> {
    let id = args["project_id"].as_str().ok_or("missing project_id")?;
    let before = project_snapshot(conn, id).ok_or("Project not found")?;

    let mut changed = Vec::new();
    if let Some(name) = args["name"].as_str() {
        conn.execute("UPDATE projects SET name = ?1, updated_at = datetime('now') WHERE id = ?2", rusqlite::params![name, id])
            .map_err(|e| e.to_string())?;
        changed.push(format!("name = {}", name));
    }
    if let Some(color) = args["color"].as_str() {
        conn.execute("UPDATE projects SET color = ?1, updated_at = datetime('now') WHERE id = ?2", rusqlite::params![color, id])
            .map_err(|e| e.to_string())?;
        changed.push(format!("color = {}", color));
    }
    if let Some(icon) = args["icon"].as_str() {
        conn.execute("UPDATE projects SET icon = ?1, icon_image = NULL, updated_at = datetime('now') WHERE id = ?2", rusqlite::params![icon, id])
            .map_err(|e| e.to_string())?;
        changed.push(format!("icon = {}", icon));
    }
    if let Some(parent_id) = args["parent_id"].as_str() {
        // Nesting a project inside its own subtree would make every subtree
        // query loop, so the move is refused rather than repaired.
        if crate::services::project_tree::would_create_cycle(conn, id, parent_id) {
            return Err("That would put the project inside itself".to_string());
        }
        conn.execute("UPDATE projects SET parent_id = ?1, updated_at = datetime('now') WHERE id = ?2", rusqlite::params![parent_id, id])
            .map_err(|e| e.to_string())?;
        changed.push(format!("parent = {}", parent_id));
    }
    if args["parent_id"].is_null() && args.get("parent_id").is_some() {
        conn.execute("UPDATE projects SET parent_id = NULL, updated_at = datetime('now') WHERE id = ?1", [id])
            .map_err(|e| e.to_string())?;
        changed.push("moved to the top level".to_string());
    }

    if changed.is_empty() {
        return Ok("No fields to update".to_string());
    }

    let after = project_snapshot(conn, id);
    super::record(conn, "update", "project", id, Some(&before), after.as_deref());
    Ok(format!("Updated project {}: {}", id, changed.join(", ")))
}

pub fn delete_project(conn: &Connection, args: &Value) -> Result<String, String> {
    let id = args["project_id"].as_str().ok_or("missing project_id")?;
    let name: String = conn
        .query_row("SELECT name FROM projects WHERE id = ?1", [id], |r| r.get(0))
        .map_err(|_| "Project not found".to_string())?;
    crate::commands::project_commands::delete_project_subtree(conn, id)?;
    Ok(format!(
        "Deleted project {} with its sub-projects; their tasks went to the archive",
        name
    ))
}

fn project_snapshot(conn: &Connection, id: &str) -> Option<String> {
    conn.query_row(
        "SELECT id, name, parent_id, icon, icon_image, icon_mono, color, \"order\", created_at, updated_at \
         FROM projects WHERE id = ?1",
        [id],
        |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "parent_id": row.get::<_, Option<String>>(2)?,
                "icon": row.get::<_, Option<String>>(3)?,
                "icon_image": row.get::<_, Option<String>>(4)?,
                "icon_mono": row.get::<_, i32>(5)? != 0,
                "color": row.get::<_, Option<String>>(6)?,
                "order": row.get::<_, i32>(7)?,
                "created_at": row.get::<_, String>(8)?,
                "updated_at": row.get::<_, String>(9)?,
            }))
        },
    )
    .ok()
    .map(|v| v.to_string())
}
