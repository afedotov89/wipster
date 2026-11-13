use rusqlite::Connection;
use std::sync::Mutex;
use tauri::AppHandle;

use super::migrations;

pub struct DbState(pub Mutex<Connection>, pub tokio::sync::RwLock<()>);

impl DbState {
    pub fn new(conn: Connection) -> Self {
        Self(Mutex::new(conn), tokio::sync::RwLock::new(()))
    }
}

pub fn init_db(app: &AppHandle) -> Result<Connection, Box<dyn std::error::Error>> {
    let app_dir = crate::services::cloud::data_dir(app)?;
    std::fs::create_dir_all(&app_dir)?;

    let active = crate::services::cloud::load(app)?;
    let db_path = crate::services::cloud::workspace(app, active.as_ref())?;
    let conn = Connection::open(&db_path)?;

    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;

    migrations::run(&conn)?;

    Ok(conn)
}

#[cfg(test)]
pub fn init_test_db() -> Connection {
    let conn = Connection::open_in_memory().expect("Failed to open in-memory DB");
    conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
    migrations::run(&conn).expect("Failed to run migrations");
    conn
}
