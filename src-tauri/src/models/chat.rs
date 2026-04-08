use serde::{Deserialize, Serialize};

use crate::services::agent::ToolCallLog;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSession {
    pub id: String,
    pub title: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub text: String,
    pub tool_calls: Option<Vec<ToolCallLog>>,
    pub executed: bool,
    pub created_at: String,
}
