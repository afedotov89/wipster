use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Inbox,
    Queue,
    Doing,
    Done,
}

impl TaskStatus {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "inbox" => Ok(Self::Inbox),
            "queue" => Ok(Self::Queue),
            "doing" => Ok(Self::Doing),
            "done" => Ok(Self::Done),
            _ => Err(format!("Invalid task status: {}", s)),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub project_id: Option<String>,
    pub status: String,
    pub priority: Option<String>,
    pub energy: Option<String>,
    pub due: Option<String>,
    pub estimate: Option<String>,
    pub time_estimate: Option<String>,
    pub tags: String,
    pub dod: Option<String>,
    pub checklist: String,
    pub next_step: Option<String>,
    pub return_ref: Option<String>,
    pub promised_to: Option<String>,
    pub comment: Option<String>,
    pub tracker_url: Option<String>,
    pub position: Option<i32>,
    pub completed_at: Option<String>,
    pub archived_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Column list for every `SELECT` that maps a row into [`Task`].
/// Must stay in sync with [`task_from_row`].
pub const TASK_COLUMNS: &str = "id, title, project_id, status, priority, energy, due, estimate, \
     time_estimate, tags, dod, checklist, next_step, return_ref, promised_to, comment, \
     tracker_url, position, completed_at, archived_at, created_at, updated_at";

/// Map a row selected with [`TASK_COLUMNS`] into a [`Task`].
pub fn task_from_row(row: &rusqlite::Row) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        project_id: row.get(2)?,
        status: row.get(3)?,
        priority: row.get(4)?,
        energy: row.get(5)?,
        due: row.get(6)?,
        estimate: row.get(7)?,
        time_estimate: row.get(8)?,
        tags: row.get(9)?,
        dod: row.get(10)?,
        checklist: row.get(11)?,
        next_step: row.get(12)?,
        return_ref: row.get(13)?,
        promised_to: row.get(14)?,
        comment: row.get(15)?,
        tracker_url: row.get(16)?,
        position: row.get(17)?,
        completed_at: row.get(18)?,
        archived_at: row.get(19)?,
        created_at: row.get(20)?,
        updated_at: row.get(21)?,
    })
}

#[derive(Debug, Deserialize)]
pub struct CreateTaskInput {
    pub title: String,
    pub project_id: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTaskInput {
    pub title: Option<String>,
    pub project_id: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub energy: Option<String>,
    pub due: Option<String>,
    pub estimate: Option<String>,
    pub time_estimate: Option<String>,
    pub tags: Option<String>,
    pub dod: Option<String>,
    pub checklist: Option<String>,
    pub next_step: Option<String>,
    pub return_ref: Option<String>,
    pub promised_to: Option<String>,
    pub comment: Option<String>,
    pub tracker_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MoveTaskInput {
    pub task_id: String,
    pub new_status: String,
    pub swap_task_id: Option<String>,
}
