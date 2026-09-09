use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    /// Parent project, or `None` for a top-level one. Any depth is allowed by
    /// the data model; the sidebar currently shows one level of nesting.
    pub parent_id: Option<String>,
    pub icon: Option<String>,
    /// A user-supplied icon as a data URL. When set it wins over `icon`.
    pub icon_image: Option<String>,
    /// The custom icon is a single-colour glyph and takes the project's colour.
    pub icon_mono: bool,
    pub color: Option<String>,
    pub order: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateProjectInput {
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProjectInput {
    pub name: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub order: Option<i32>,
    /// `null` removes the custom icon and falls back to the built-in one.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub icon_image: Option<Option<String>>,
    pub icon_mono: Option<bool>,
    /// Three states on purpose: absent leaves the parent alone, `null` promotes
    /// the project to the top level, an id nests it under that project.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub parent_id: Option<Option<String>>,
}

fn deserialize_optional_field<'de, D>(deserializer: D) -> Result<Option<Option<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Some(Option::deserialize(deserializer)?))
}
