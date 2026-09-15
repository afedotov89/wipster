//! Which model answers, with what key, at what address.
//!
//! One table of providers and one reader for the settings, because four
//! features ask this question — the assistant, field autocomplete, AI-fill and
//! the connection self-test. A provider that reached only three of them would
//! be a provider the user cannot trust.

use rusqlite::Connection;
use serde::Serialize;

/// How a provider speaks.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Api {
    /// Anthropic's own Messages API.
    Anthropic,
    /// The OpenAI-shaped `/chat/completions` everyone else implements.
    OpenAi,
}

/// A service the app can ask, and what it takes to reach it.
#[derive(Serialize)]
pub struct Provider {
    pub id: &'static str,
    /// The vendor's own name. Not translated — brands are not words.
    pub label: &'static str,
    pub api: Api,
    /// Where it lives. Empty when the address is the user's to give: a
    /// self-hosted model, a company gateway, a vendor that did not exist when
    /// this shipped.
    pub base_url: &'static str,
    pub default_model: &'static str,
    /// What its key looks like, so the field can show a real example.
    pub key_hint: &'static str,
    /// An example of a model name, for the same reason.
    pub model_hint: &'static str,
    /// The largest answer it will accept a request for. DeepSeek rejects
    /// anything above 8192 outright, so this is not a preference but a limit.
    pub max_output_tokens: u32,
}

/// Everything the app can talk to. Adding a service is one row here: the
/// settings screen reads this list, so nothing else has to be touched.
pub const PROVIDERS: &[Provider] = &[
    Provider {
        id: "anthropic",
        label: "Anthropic",
        api: Api::Anthropic,
        base_url: "https://api.anthropic.com",
        default_model: "claude-sonnet-4-20250514",
        key_hint: "sk-ant-...",
        model_hint: "claude-sonnet-4-20250514",
        max_output_tokens: 16000,
    },
    Provider {
        id: "openrouter",
        label: "OpenRouter",
        api: Api::OpenAi,
        base_url: "https://openrouter.ai/api/v1",
        default_model: "anthropic/claude-sonnet-4",
        key_hint: "sk-or-...",
        model_hint: "anthropic/claude-sonnet-4",
        max_output_tokens: 16000,
    },
    Provider {
        id: "deepseek",
        label: "DeepSeek Platform",
        api: Api::OpenAi,
        base_url: "https://api.deepseek.com",
        // Their current line-up is deepseek-flash (V4.1-Flash) and
        // deepseek-v4-pro; the older aliases are still accepted but the models
        // behind them are retired.
        default_model: "deepseek-flash",
        key_hint: "sk-...",
        model_hint: "deepseek-flash",
        max_output_tokens: 16000,
    },
    Provider {
        id: "custom",
        label: "OpenAI-compatible",
        api: Api::OpenAi,
        base_url: "",
        default_model: "",
        key_hint: "sk-...",
        model_hint: "gpt-4o-mini",
        max_output_tokens: 4096,
    },
];

/// The provider with this id — anything unknown is treated as the default one,
/// because a stale setting must never leave the app unable to answer.
pub fn provider(id: &str) -> &'static Provider {
    PROVIDERS
        .iter()
        .find(|p| p.id == id)
        .unwrap_or(&PROVIDERS[0])
}

/// Everything a call needs: who, with what key, where, as which model.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LlmConfig {
    pub provider_id: String,
    pub api: Api,
    pub api_key: String,
    pub model: String,
    pub base_url: String,
    pub max_output_tokens: u32,
}

impl LlmConfig {
    /// Read what the user set up. The settings hold one key per provider, so
    /// switching back and forth never costs a trip for a new key.
    pub fn read(conn: &Connection) -> Result<Self, String> {
        let setting = |key: &str| -> Option<String> {
            conn.query_row(
                "SELECT value FROM settings WHERE key = ?1",
                [key],
                |r| r.get::<_, String>(0),
            )
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
        };

        let p = provider(setting("llm_provider").as_deref().unwrap_or("anthropic"));

        let api_key = setting(&format!("{}_api_key", p.id)).ok_or("API_KEY_NOT_SET")?;

        // The address first: without it there is nowhere to send even a
        // perfectly good model name.
        let base_url = if p.base_url.is_empty() {
            setting("llm_base_url").ok_or("BASE_URL_NOT_SET")?
        } else {
            p.base_url.to_string()
        };

        let model = setting("llm_model").unwrap_or_else(|| p.default_model.to_string());
        if model.is_empty() {
            return Err("MODEL_NOT_SET".to_string());
        }

        Ok(LlmConfig {
            provider_id: p.id.to_string(),
            api: p.api,
            api_key,
            model,
            base_url,
            max_output_tokens: p.max_output_tokens,
        })
    }

    /// As many tokens as asked for, but never more than the service allows.
    pub fn answer_tokens(&self, wanted: u32) -> u32 {
        wanted.min(self.max_output_tokens)
    }

    pub fn is_anthropic(&self) -> bool {
        self.api == Api::Anthropic
    }

    /// Where the chat call goes.
    ///
    /// Forgiving about what was pasted: an address that already names the
    /// endpoint is used as it stands, a bare one gets the endpoint added —
    /// people copy both from documentation and neither is wrong.
    pub fn chat_url(&self) -> String {
        let base = self.base_url.trim().trim_end_matches('/');
        match self.api {
            Api::Anthropic => {
                if base.ends_with("/messages") {
                    base.to_string()
                } else {
                    format!("{base}/v1/messages")
                }
            }
            Api::OpenAi => {
                if base.ends_with("/chat/completions") {
                    base.to_string()
                } else {
                    format!("{base}/chat/completions")
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db(settings: &[(&str, &str)]) -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)")
            .unwrap();
        for (key, value) in settings {
            conn.execute("INSERT INTO settings VALUES (?1, ?2)", [key, value])
                .unwrap();
        }
        conn
    }

    #[test]
    fn each_provider_has_its_own_key_and_default_model() {
        let conn = db(&[
            ("llm_provider", "deepseek"),
            ("anthropic_api_key", "sk-ant-wrong"),
            ("deepseek_api_key", "sk-right"),
        ]);

        let cfg = LlmConfig::read(&conn).unwrap();

        assert_eq!(cfg.api_key, "sk-right");
        assert_eq!(cfg.model, "deepseek-flash");
        assert_eq!(cfg.chat_url(), "https://api.deepseek.com/chat/completions");
        assert!(!cfg.is_anthropic());
    }

    #[test]
    fn an_unknown_provider_falls_back_instead_of_failing() {
        let conn = db(&[
            ("llm_provider", "something-we-dropped"),
            ("anthropic_api_key", "sk-ant-x"),
        ]);

        let cfg = LlmConfig::read(&conn).unwrap();

        assert_eq!(cfg.provider_id, "anthropic");
        assert_eq!(cfg.chat_url(), "https://api.anthropic.com/v1/messages");
        assert!(cfg.is_anthropic());
    }

    #[test]
    fn a_custom_endpoint_needs_its_address_and_model() {
        let missing_url = db(&[("llm_provider", "custom"), ("custom_api_key", "sk-x")]);
        assert_eq!(LlmConfig::read(&missing_url), Err("BASE_URL_NOT_SET".to_string()));

        let missing_model = db(&[
            ("llm_provider", "custom"),
            ("custom_api_key", "sk-x"),
            ("llm_base_url", "https://llm.company.ru/v1"),
        ]);
        assert_eq!(LlmConfig::read(&missing_model), Err("MODEL_NOT_SET".to_string()));

        let ready = db(&[
            ("llm_provider", "custom"),
            ("custom_api_key", "sk-x"),
            ("llm_base_url", "https://llm.company.ru/v1/"),
            ("llm_model", "qwen3-32b"),
        ]);
        let cfg = LlmConfig::read(&ready).unwrap();
        assert_eq!(cfg.chat_url(), "https://llm.company.ru/v1/chat/completions");
    }

    #[test]
    fn an_address_that_already_names_the_endpoint_is_left_alone() {
        let conn = db(&[
            ("llm_provider", "custom"),
            ("custom_api_key", "sk-x"),
            ("llm_base_url", "https://llm.company.ru/v1/chat/completions"),
            ("llm_model", "qwen3-32b"),
        ]);

        assert_eq!(
            LlmConfig::read(&conn).unwrap().chat_url(),
            "https://llm.company.ru/v1/chat/completions",
        );
    }

    #[test]
    fn a_request_never_asks_for_more_than_the_service_allows() {
        let conn = db(&[
            ("llm_provider", "custom"),
            ("custom_api_key", "sk-x"),
            ("llm_base_url", "https://llm.company.ru/v1"),
            ("llm_model", "qwen3-32b"),
        ]);
        let cfg = LlmConfig::read(&conn).unwrap();

        // Nothing is known about someone's own gateway, so the ask stays modest
        // — a service that refuses an oversized max_tokens refuses the whole
        // request, and a truncated answer is better than no answer.
        assert_eq!(cfg.answer_tokens(16000), 4096);
        assert_eq!(cfg.answer_tokens(500), 500);
    }

    #[test]
    fn without_a_key_there_is_nothing_to_call() {
        let conn = db(&[("llm_provider", "openrouter")]);
        assert_eq!(LlmConfig::read(&conn), Err("API_KEY_NOT_SET".to_string()));
    }
}
