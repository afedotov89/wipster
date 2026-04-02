use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

use super::migrations;

pub struct DbState(pub Mutex<Connection>);

impl DbState {
    pub fn new(conn: Connection) -> Self {
        Self(Mutex::new(conn))
    }
}

pub fn init_db(app: &AppHandle) -> Result<Connection, Box<dyn std::error::Error>> {
    let app_dir = app
        .path()
        .app_data_dir()?;
    std::fs::create_dir_all(&app_dir)?;

    let db_path = app_dir.join("wipster.db");
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
