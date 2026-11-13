//! Server-mediated Yandex ID. Attempt proof and Wipster session never cross IPC.
use super::cloud::{self, CloudState};
use super::cloud_db::Result;
use crate::db::connection::DbState;
use reqwest::{Method, Url};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::{AppHandle, State};
use tokio::{
    sync::{watch, Mutex},
    time::{sleep, timeout},
};

const CALLBACK: &str = "https://wipster.fedotovs.net/api/v1/auth/yandex/callback";
#[derive(Default)]
pub struct YandexState(Mutex<Option<watch::Sender<bool>>>);

#[tauri::command]
pub async fn cloud_yandex_cancel(yandex: State<'_, YandexState>) -> Result<()> {
    if let Some(cancel) = yandex.0.lock().await.as_ref() {
        let _ = cancel.send(true);
    }
    Ok(())
}

fn authorization_url(begin: &Value) -> Result<Url> {
    let invalid = || "Invalid Yandex authorization configuration".to_string();
    let url = Url::parse(begin["authorization_url"].as_str().ok_or_else(invalid)?)
        .map_err(|_| invalid())?;
    if url.scheme() != "https"
        || url.host_str() != Some("oauth.yandex.ru")
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/authorize"
        || url.fragment().is_some()
    {
        return Err(invalid());
    }
    let state = begin["state"].as_str().ok_or_else(invalid)?;
    let challenge = begin["code_challenge"].as_str().ok_or_else(invalid)?;
    let valid_random = |s: &str| {
        s.len() == 43
            && s.bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
    };
    if !valid_random(state) || !valid_random(challenge) {
        return Err(invalid());
    }
    let pairs: Vec<_> = url.query_pairs().collect();
    for (key, expected) in [
        ("redirect_uri", CALLBACK),
        ("state", state),
        ("code_challenge", challenge),
        ("response_type", "code"),
        ("code_challenge_method", "S256"),
        ("scope", "login:email"),
        ("force_confirm", "yes"),
    ] {
        let values: Vec<_> = pairs
            .iter()
            .filter(|(k, _)| k == key)
            .map(|(_, v)| v.as_ref())
            .collect();
        if values != [expected] {
            return Err(invalid());
        }
    }
    let ids: Vec<_> = pairs
        .iter()
        .filter(|(k, _)| k == "client_id")
        .map(|(_, v)| v.as_ref())
        .collect();
    if pairs.len() != 8
        || ids.len() != 1
        || ids[0].len() != 32
        || !ids[0].bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(invalid());
    }
    Ok(url)
}

async fn cancelled(cancel: &mut watch::Receiver<bool>) {
    if !*cancel.borrow() {
        let _ = cancel.changed().await;
    }
}

async fn authorize(
    o: &str,
    credential: Option<&str>,
    cancel: &mut watch::Receiver<bool>,
) -> Result<Value> {
    authorize_with_browser(o, credential, cancel, |url| {
        open::that(url.as_str())
            .map_err(|_| "Cannot open the system browser. Please try again.".into())
    })
    .await
}

async fn authorize_with_browser<F>(
    o: &str,
    credential: Option<&str>,
    cancel: &mut watch::Receiver<bool>,
    browser: F,
) -> Result<Value>
where
    F: FnOnce(&Url) -> Result<()> + Send,
{
    let prefix = if credential.is_some() {
        "auth/yandex/link"
    } else {
        "auth/yandex"
    };
    // Do not abort start in-flight: its response is needed to cancel a created attempt.
    let (s, begin) = cloud::request(
        o,
        Method::POST,
        &format!("{prefix}/start"),
        credential,
        Some(&json!({"device_name":"Wipster native"})),
    )
    .await?;
    if s != 200 {
        return Err(cloud::api_error(s, &begin));
    }
    let attempt_id = begin["attempt_id"]
        .as_str()
        .ok_or("Invalid Yandex sign-in attempt")?;
    uuid::Uuid::parse_str(attempt_id).map_err(|_| "Invalid Yandex sign-in attempt")?;
    let attempt_proof = begin["proof"]
        .as_str()
        .ok_or("Invalid Yandex sign-in attempt")?;
    if attempt_proof.len() != 43
        || !attempt_proof
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err("Invalid Yandex sign-in attempt".into());
    }
    let proof = json!({"attempt_id":attempt_id,"proof":attempt_proof});
    let operation = async {
        let url = authorization_url(&begin)?;
        browser(&url)?;
        loop {
            // Temporary transport failures are retried within the same bounded attempt.
            match cloud::request(
                o,
                Method::POST,
                &format!("{prefix}/status"),
                credential,
                Some(&proof),
            )
            .await
            {
                Ok((200, result)) => match result["status"].as_str() {
                    Some("ready" | "finished") => {
                        match cloud::request(
                            o,
                            Method::POST,
                            &format!("{prefix}/finish"),
                            credential,
                            Some(&proof),
                        )
                        .await
                        {
                            Ok((200, session)) => return Ok(session),
                            Ok((s, body)) => return Err(cloud::api_error(s, &body)),
                            Err(_) => {} // lost finish response: next poll redelivers the same session
                        }
                    }
                    Some("pending" | "exchanging") => {}
                    Some("denied") => {
                        return Err("Yandex sign-in was declined. Please try again.".into())
                    }
                    Some("cancelled") => return Err("Yandex sign-in cancelled".into()),
                    Some("failed") => return Err("Yandex sign-in failed. Please try again.".into()),
                    _ => return Err("Invalid Yandex sign-in status".into()),
                },
                Ok((s, body)) => return Err(cloud::api_error(s, &body)),
                Err(_) => {}
            }
            sleep(Duration::from_secs(2)).await;
        }
    };
    let result = tokio::select! { biased;
        _ = cancelled(cancel) => Err("Yandex sign-in cancelled".into()),
        r = timeout(Duration::from_secs(300), operation) => r.unwrap_or_else(|_| Err("Yandex sign-in timed out. Please try again.".into())),
    };
    if result.is_err() {
        let _ = cloud::request(
            o,
            Method::POST,
            &format!("{prefix}/cancel"),
            credential,
            Some(&proof),
        )
        .await;
    }
    result
}

#[tauri::command]
pub async fn cloud_yandex_login(
    app: AppHandle,
    db: State<'_, DbState>,
    cloud: State<'_, CloudState>,
    yandex: State<'_, YandexState>,
    origin_url: String,
    import_local: bool,
    link: bool,
) -> Result<()> {
    if cfg!(any(target_os = "android", target_os = "ios")) {
        return Err("Yandex sign-in requires a separate mobile platform flow".into());
    }
    let o = cloud::origin(&origin_url)?;
    let (sender, mut cancel) = watch::channel(false);
    {
        let mut pending = yandex.0.lock().await;
        if pending.is_some() {
            return Err("A Yandex sign-in is already pending".into());
        }
        *pending = Some(sender);
    }
    let operation = async {
        let (active, credential) = {
            let rt = cloud.0.lock().await;
            match (&rt.active, link) {
                (Some(a), true) if a.origin == o => (Some(a.clone()), Some(cloud::token(a)?)),
                (None, false) => (None, None),
                _ => return Err("Sign out before changing account".into()),
            }
        };
        let result = authorize(&o, credential.as_deref(), &mut cancel).await?;
        if link {
            let mut rt = cloud.0.lock().await;
            let a = rt
                .active
                .as_mut()
                .ok_or("Session changed; please try again")?;
            if *cancel.borrow()
                || active.as_ref().map(|x| &x.credential_id) != Some(&a.credential_id)
            {
                return Err("Session changed; please try again".into());
            }
            a.email = result["email"].as_str().unwrap_or_default().into();
            a.name = result["name"].as_str().unwrap_or_default().into();
            a.yandex_linked = true;
            return cloud::persist(&app, Some(a));
        }
        let installed = async {
            let mut rt = cloud.0.lock().await;
            if rt.active.is_some() {
                return Err("Sign out before changing account".into());
            }
            let _exclusive = db.1.try_write().map_err(|_| {
                "Wait for the assistant or integration request to finish before changing workspace"
            })?;
            cloud::install_session(
                &app,
                &db,
                &mut rt,
                o.clone(),
                &result,
                import_local,
                Some(&cancel),
            )
            .await
        }
        .await;
        // Failure/cancel must not leave a usable new session when the API is reachable.
        if installed.is_err() {
            if let Some(token) = result["token"].as_str() {
                let _ = cloud::request(
                    &o,
                    Method::POST,
                    "auth/logout",
                    Some(token),
                    Some(&json!({})),
                )
                .await;
            }
        }
        installed
    }
    .await;
    *yandex.0.lock().await = None;
    operation
}

#[cfg(test)]
pub(super) async fn test_authorize(o: &str, subject: &str) -> Result<Value> {
    let (_sender, mut cancel) = watch::channel(false);
    let local = o.to_string();
    let subject = subject.to_string();
    authorize_with_browser(o, None, &mut cancel, move |url| {
        let state = url
            .query_pairs()
            .find(|(k, _)| k == "state")
            .unwrap()
            .1
            .into_owned();
        let challenge = url
            .query_pairs()
            .find(|(k, _)| k == "code_challenge")
            .unwrap()
            .1
            .into_owned();
        tokio::spawn(async move {
            let code = format!("native-mock-code:{challenge}:{subject}");
            let result = reqwest::Client::new()
                .get(format!("{local}/api/v1/auth/yandex/callback"))
                .query(&[("state", state.as_str()), ("code", code.as_str())])
                .send()
                .await
                .unwrap();
            assert_eq!(result.status(), 200);
            let page = result.text().await.unwrap();
            assert!(!page.contains(&state) && !page.contains("native-mock-code"));
        });
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn begin() -> Value {
        let mut url = Url::parse("https://oauth.yandex.ru/authorize").unwrap();
        url.query_pairs_mut().extend_pairs([
            ("redirect_uri", CALLBACK),
            ("state", &"s".repeat(43)),
            ("code_challenge", &"c".repeat(43)),
            ("client_id", &"a".repeat(32)),
            ("response_type", "code"),
            ("scope", "login:email"),
            ("code_challenge_method", "S256"),
            ("force_confirm", "yes"),
        ]);
        json!({"authorization_url":url.as_str(),"state":"s".repeat(43),"code_challenge":"c".repeat(43)})
    }
    #[test]
    fn opens_only_yandex_fixed_endpoint_callback_and_scope() {
        let original = begin();
        assert!(authorization_url(&original).is_ok());
        for replacement in [
            original["authorization_url"]
                .as_str()
                .unwrap()
                .replace("oauth.yandex.ru", "evil.test"),
            original["authorization_url"]
                .as_str()
                .unwrap()
                .replace("https:", "http:"),
            original["authorization_url"]
                .as_str()
                .unwrap()
                .replace("login%3Aemail", "login%3Aemail+mail%3Aread"),
            original["authorization_url"]
                .as_str()
                .unwrap()
                .replace("callback", "callback/"),
            format!(
                "{}&state=other",
                original["authorization_url"].as_str().unwrap()
            ),
            format!(
                "{}&proof=secret",
                original["authorization_url"].as_str().unwrap()
            ),
        ] {
            let mut bad = original.clone();
            bad["authorization_url"] = json!(replacement);
            assert!(authorization_url(&bad).is_err());
        }
    }
    #[tokio::test]
    async fn cancellation_is_observed_even_before_polling() {
        let (sender, mut receiver) = watch::channel(false);
        sender.send(true).unwrap();
        timeout(Duration::from_millis(20), cancelled(&mut receiver))
            .await
            .unwrap();
    }

    // Real HTTP client exercises polling, cancellation, denial and lost finish delivery.
    async fn mock_api(
        status: &'static str,
        lose_finish: bool,
    ) -> (
        String,
        tokio::task::JoinHandle<()>,
        std::sync::Arc<Mutex<Vec<(String, Value)>>>,
    ) {
        use tokio::{
            io::{AsyncReadExt, AsyncWriteExt},
            net::TcpListener,
        };
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let calls = std::sync::Arc::new(Mutex::new(Vec::new()));
        let received = calls.clone();
        let task = tokio::spawn(async move {
            let mut finishes = 0;
            loop {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut bytes = Vec::new();
                let (path, body) = loop {
                    let mut chunk = [0; 4096];
                    let n = stream.read(&mut chunk).await.unwrap();
                    if n == 0 {
                        break (String::new(), Value::Null);
                    }
                    bytes.extend_from_slice(&chunk[..n]);
                    let raw = String::from_utf8_lossy(&bytes);
                    if let Some((headers, body)) = raw.split_once("\r\n\r\n") {
                        let length: usize = headers
                            .lines()
                            .filter_map(|l| l.split_once(':'))
                            .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
                            .unwrap()
                            .1
                            .trim()
                            .parse()
                            .unwrap();
                        if body.len() == length {
                            break (
                                headers
                                    .lines()
                                    .next()
                                    .unwrap()
                                    .split_whitespace()
                                    .nth(1)
                                    .unwrap()
                                    .to_string(),
                                serde_json::from_str(body).unwrap(),
                            );
                        }
                    }
                };
                received.lock().await.push((path.clone(), body));
                let response = if path.ends_with("/start") {
                    let mut data = begin();
                    data["proof"] = json!("p".repeat(43));
                    data["attempt_id"] = json!("00000000-0000-4000-8000-000000000001");
                    data
                } else if path.ends_with("/status") {
                    json!({"status":status})
                } else if path.ends_with("/finish") {
                    finishes += 1;
                    if lose_finish && finishes == 1 {
                        continue;
                    } // disconnect after commit
                    json!({"token":"native-only-session","account_id":"account"})
                } else {
                    json!({"ok":true})
                };
                let raw = response.to_string();
                stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{}",raw.len(),raw).as_bytes()).await.unwrap();
            }
        });
        (origin, task, calls)
    }

    #[tokio::test]
    async fn lost_finish_response_retries_same_native_proof_without_browser_secrets() {
        let (origin, server, calls) = mock_api("ready", true).await;
        let (_sender, mut cancel) = watch::channel(false);
        let result = timeout(
            Duration::from_secs(10),
            authorize_with_browser(&origin, None, &mut cancel, |url| {
                assert!(!url.as_str().contains(&"p".repeat(43)));
                assert!(!url.as_str().contains("proof") && !url.as_str().contains("token"));
                Ok(())
            }),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(result["token"], "native-only-session");
        let calls = calls.lock().await;
        let finishes: Vec<_> = calls
            .iter()
            .filter(|(p, _)| p.ends_with("/finish"))
            .collect();
        assert_eq!(finishes.len(), 2);
        assert_eq!(finishes[0].1, finishes[1].1);
        server.abort();
    }

    #[tokio::test]
    async fn denial_and_user_cancellation_cancel_the_server_attempt_without_finishing() {
        for denied in [true, false] {
            let (origin, server, calls) =
                mock_api(if denied { "denied" } else { "pending" }, false).await;
            let (sender, mut cancel) = watch::channel(false);
            let result = authorize_with_browser(&origin, None, &mut cancel, |_| {
                if !denied {
                    sender.send(true).unwrap();
                }
                Ok(())
            })
            .await
            .unwrap_err();
            assert!(result.contains(if denied { "declined" } else { "cancelled" }));
            let calls = calls.lock().await;
            assert!(calls.iter().any(|(p, _)| p.ends_with("/cancel")));
            assert!(!calls.iter().any(|(p, _)| p.ends_with("/finish")));
            server.abort();
        }
    }
}
