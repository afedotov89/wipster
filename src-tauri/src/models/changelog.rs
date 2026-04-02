use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangeLogEntry {
    pub id: String,
    pub created_at: String,
    pub actor: String,
    pub action: String,
    pub entity_type: String,
    pub entity_id: String,
    pub old_value: Option<String>,
    pub new_value: Option<String>,
    pub undone: bool,
    pub batch_id: Option<String>,
}
