use serde::{Deserialize, Serialize};

use crate::services::agent::{PendingToolCall, ToolCallLog};

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
    pub pending_confirmations: Option<Vec<PendingToolCall>>,
    /// One of: "pending", "confirmed", "cancelled". None when no confirmation needed.
    pub confirmation_status: Option<String>,
    pub created_at: String,
}
