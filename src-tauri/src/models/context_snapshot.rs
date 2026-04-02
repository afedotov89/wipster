use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextSnapshot {
    pub id: String,
    pub task_id: Option<String>,
    pub captured_at: String,
    pub app: Option<String>,
    pub window_title: Option<String>,
    pub url: Option<String>,
    pub repo: Option<String>,
    pub branch: Option<String>,
    pub file_path: Option<String>,
    pub note: Option<String>,
}
