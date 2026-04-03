use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_url: String,
    pub interval: u64,
    pub expires_in: u64,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    error: Option<String>,
}

/// Step 1: Request device code from Yandex
pub async fn request_device_code(client_id: &str) -> Result<DeviceCodeResponse, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://oauth.yandex.ru/device/code")
        .form(&[("client_id", client_id)])
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Device code error: {}", body));
    }

    resp.json().await.map_err(|e| format!("Parse error: {}", e))
}

/// Step 2: Poll for token until user authorizes
pub async fn poll_for_token(client_id: &str, client_secret: &str, device_code: &str, interval: u64, expires_in: u64) -> Result<String, String> {
    let client = reqwest::Client::new();
    let max_attempts = expires_in / interval;

    for _ in 0..max_attempts {
        tokio::time::sleep(std::time::Duration::from_secs(interval)).await;

        let resp = client
            .post("https://oauth.yandex.ru/token")
            .form(&[
                ("grant_type", "device_code"),
                ("code", device_code),
                ("client_id", client_id),
                ("client_secret", client_secret),
            ])
            .send()
            .await
            .map_err(|e| format!("Poll failed: {}", e))?;

        let token_resp: TokenResponse = resp.json().await.map_err(|e| e.to_string())?;

        if let Some(token) = token_resp.access_token {
            return Ok(token);
        }

        if let Some(err) = &token_resp.error {
            if err != "authorization_pending" {
                return Err(format!("Auth error: {}", err));
            }
        }
    }

    Err("Authorization timed out".to_string())
}

/// Auto-detect organization ID from Yandex Tracker API
pub async fn detect_org_id(token: &str) -> Result<String, String> {
    let client = reqwest::Client::new();

    // Try with X-Cloud-Org-Id first (Yandex Cloud orgs)
    for header_name in ["X-Cloud-Org-Id", "X-Org-Id"] {
        let resp = client
            .get("https://api.tracker.yandex.net/v2/myself")
            .header("Authorization", format!("OAuth {}", token))
            .header(header_name, "0")
            .send()
            .await;

        if let Ok(r) = resp {
            if r.status().is_success() {
                let json: serde_json::Value = r.json().await.unwrap_or_default();
                // Check organization in response body
                for path in [&["organization", "id"], &["organizationId", ""], &["orgId", ""]] {
                    if let Some(org) = json.pointer(&format!("/{}", path[0])) {
                        let id = org.as_str().map(|s| s.to_string())
                            .or_else(|| org.as_i64().map(|n| n.to_string()));
                        if let Some(id) = id {
                            if !id.is_empty() && id != "0" {
                                return Ok(id);
                            }
                        }
                    }
                }
            }
        }
    }

    Err("Не удалось определить Org ID автоматически. Введите вручную.".to_string())
}
