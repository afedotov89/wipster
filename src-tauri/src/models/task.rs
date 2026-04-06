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
    pub position: Option<i32>,
    pub created_at: String,
    pub updated_at: String,
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
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MoveTaskInput {
    pub task_id: String,
    pub new_status: String,
    pub swap_task_id: Option<String>,
}
