//! Desktop system-browser OAuth. Codes, verifiers, proofs and provider URLs stay in Rust.
use super::cloud::{self, CloudState};
use super::cloud_db::Result;
use crate::db::connection::DbState;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use reqwest::{Method, Url};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::Duration;
use tauri::{AppHandle, State};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::{watch, Mutex},
    time::{timeout, Instant},
};

#[derive(Default)]
pub struct GoogleState(Mutex<Option<watch::Sender<bool>>>);

#[tauri::command]
pub async fn cloud_capabilities(origin_url: String) -> Result<Value> {
    let o = cloud::origin(&origin_url)?;
    let (s, b) = cloud::request(&o, Method::GET, "auth/capabilities", None, None).await?;
    if s != 200 {
        return Err(cloud::api_error(s, &b));
    }
    // Project only public flags, never arbitrary server fields into React.
    Ok(json!({"yandex":b["yandex"] == true,"google":b["google"] == true,"sms":b["sms"] == true}))
}

#[tauri::command]
pub async fn cloud_google_cancel(google: State<'_, GoogleState>) -> Result<()> {
    if let Some(cancel) = google.0.lock().await.as_ref() {
        let _ = cancel.send(true);
    }
    Ok(())
}

fn verifier() -> String {
    // Three independent OS-random v4 UUIDs provide 366 random bits (RFC 7636 >=256).
    (0..3)
        .map(|_| uuid::Uuid::new_v4().simple().to_string())
        .collect()
}
fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn authorization_url(raw: &str, redirect: &str, state: &str, pkce: &str) -> Result<Url> {
    let url = Url::parse(raw).map_err(|_| "Invalid Google authorization configuration")?;
    if url.scheme() != "https"
        || url.host_str() != Some("accounts.google.com")
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/o/oauth2/v2/auth"
        || url.fragment().is_some()
    {
        return Err("Invalid Google authorization configuration".into());
    }
    let pairs: Vec<_> = url.query_pairs().collect();
    for (key, expected) in [
        ("redirect_uri", redirect),
        ("state", state),
        ("code_challenge", pkce),
        ("response_type", "code"),
        ("code_challenge_method", "S256"),
        ("scope", "openid email"),
        ("prompt", "select_account"),
    ] {
        let values: Vec<_> = pairs
            .iter()
            .filter(|(k, _)| k == key)
            .map(|(_, v)| v.as_ref())
            .collect();
        if values != [expected] {
            return Err("Invalid Google authorization configuration".into());
        }
    }
    if pairs.iter().filter(|(k, _)| k == "nonce").count() != 1
        || pairs.iter().filter(|(k, _)| k == "client_id").count() != 1
    {
        return Err("Invalid Google authorization configuration".into());
    }
    Ok(url)
}

// Invalid/unrelated local requests never complete an attempt or echo their contents.
fn callback(raw: &str, port: u16, state: &str) -> Result<Option<Result<String>>> {
    let mut lines = raw.split("\r\n");
    let first: Vec<_> = lines.next().unwrap_or("").split(' ').collect();
    if first.len() != 3
        || first[0] != "GET"
        || first[2] != "HTTP/1.1"
        || !first[1].starts_with("/?")
    {
        return Ok(None);
    }
    let hosts: Vec<_> = lines
        .filter_map(|l| l.split_once(':'))
        .filter(|(k, _)| k.eq_ignore_ascii_case("host"))
        .map(|(_, v)| v.trim())
        .collect();
    if hosts != [format!("127.0.0.1:{port}")] {
        return Ok(None);
    }
    let url = Url::parse(&format!("http://127.0.0.1:{port}{}", first[1]))
        .map_err(|_| "Invalid Google callback")?;
    if url.path() != "/" || url.fragment().is_some() {
        return Ok(None);
    }
    let pairs: Vec<_> = url.query_pairs().collect();
    let values = |key: &str| {
        pairs
            .iter()
            .filter(|(k, _)| k == key)
            .map(|(_, v)| v.to_string())
            .collect::<Vec<_>>()
    };
    if values("state") != [state] {
        return Ok(None);
    }
    let codes = values("code");
    let errors = values("error");
    if errors.len() == 1 && codes.is_empty() {
        return Ok(Some(Err(if errors[0] == "access_denied" {
            "Google sign-in was declined. Please try again."
        } else {
            "Google sign-in failed. Please try again."
        }
        .into())));
    }
    if codes.len() != 1 || !errors.is_empty() || codes[0].is_empty() || codes[0].len() > 4096 {
        return Ok(None);
    }
    Ok(Some(Ok(codes[0].clone())))
}

async fn wait_callback(listener: &TcpListener, state: &str, duration: Duration) -> Result<String> {
    let port = listener
        .local_addr()
        .map_err(|_| "Google callback unavailable")?
        .port();
    let deadline = Instant::now() + duration;
    loop {
        let (mut stream, peer) = timeout(
            deadline.saturating_duration_since(Instant::now()),
            listener.accept(),
        )
        .await
        .map_err(|_| "Google sign-in timed out. Please try again.")?
        .map_err(|_| "Google callback unavailable")?;
        if !peer.ip().is_loopback() {
            continue;
        }
        let read = async {
            let mut raw = Vec::new();
            let mut buffer = [0; 1024];
            while !raw.windows(4).any(|w| w == b"\r\n\r\n") {
                let n = stream.read(&mut buffer).await.ok()?;
                if n == 0 || raw.len() + n > 8192 {
                    return None;
                }
                raw.extend_from_slice(&buffer[..n]);
            }
            String::from_utf8(raw).ok()
        };
        let parsed = match timeout(Duration::from_secs(2), read).await {
            Ok(Some(raw)) => callback(&raw, port, state)?,
            _ => None,
        };
        let status = if parsed.is_some() {
            "200 OK"
        } else {
            "400 Bad Request"
        };
        let page = "<!doctype html><html><meta charset=utf-8><title>Wipster</title><body>Return to Wipster. You can close this window.</body></html>";
        let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; frame-ancestors 'none'\r\nConnection: close\r\n\r\n{page}",page.len());
        let _ = timeout(
            Duration::from_secs(1),
            stream.write_all(response.as_bytes()),
        )
        .await;
        if let Some(result) = parsed {
            return result;
        }
    }
}

async fn cancelled(cancel: &mut watch::Receiver<bool>) {
    if *cancel.borrow() {
        return;
    }
    let _ = cancel.changed().await;
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
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|_| "Cannot open the local Google callback")?;
    let redirect = format!(
        "http://127.0.0.1:{}/",
        listener
            .local_addr()
            .map_err(|_| "Cannot open Google callback")?
            .port()
    );
    let verifier = verifier();
    let pkce = challenge(&verifier);
    let prefix = if credential.is_some() {
        "auth/google/link"
    } else {
        "auth/google"
    };
    let (s, begin) = cloud::request(
        o,
        Method::POST,
        &format!("{prefix}/start"),
        credential,
        Some(&json!({"redirect_uri":redirect,"code_challenge":pkce})),
    )
    .await?;
    if s != 200 {
        return Err(cloud::api_error(s, &begin));
    }
    let proof = json!({"attempt_id":begin["attempt_id"],"proof":begin["proof"]});
    let operation = async {
        let state = begin["state"]
            .as_str()
            .ok_or("Invalid Google authorization configuration")?;
        let url = authorization_url(
            begin["authorization_url"]
                .as_str()
                .ok_or("Invalid Google authorization configuration")?,
            &redirect,
            state,
            &pkce,
        )?;
        // External system browser only; fixed trusted endpoint validated above.
        browser(&url)?;
        let code = wait_callback(&listener, state, Duration::from_secs(300)).await?;
        let (s, result) = cloud::request(
            o,
            Method::POST,
            &format!("{prefix}/finish"),
            credential,
            Some(
                &json!({"attempt_id":begin["attempt_id"],"proof":begin["proof"],"state":state,
                "code":code,"code_verifier":verifier,"device_name":"Wipster native"}),
            ),
        )
        .await?;
        if s != 200 {
            return Err(cloud::api_error(s, &result));
        }
        Ok(result)
    };
    let result = tokio::select! { biased;
        _ = cancelled(cancel) => Err("Google sign-in cancelled".into()),
        r = operation => r,
    };
    drop(listener);
    if result.is_err() {
        // Best effort only; expiry/consumption remain authoritative if the API is offline.
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
pub async fn cloud_google_login(
    app: AppHandle,
    db: State<'_, DbState>,
    cloud: State<'_, CloudState>,
    google: State<'_, GoogleState>,
    origin_url: String,
    import_local: bool,
    link: bool,
) -> Result<()> {
    if cfg!(any(target_os = "android", target_os = "ios")) {
        return Err("Google sign-in requires a separate mobile platform flow".into());
    }
    let o = cloud::origin(&origin_url)?;
    let (sender, mut cancel) = watch::channel(false);
    {
        let mut pending = google.0.lock().await;
        if pending.is_some() {
            return Err("A Google sign-in is already pending".into());
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
            a.google_linked = true;
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
    *google.0.lock().await = None;
    operation
}

#[cfg(test)]
pub(super) async fn test_authorize(o: &str) -> Result<Value> {
    let (_sender, mut cancel) = watch::channel(false);
    authorize_with_browser(o, None, &mut cancel, |url| {
        let pairs: std::collections::HashMap<_,_>=url.query_pairs().into_owned().collect();
        let redirect=Url::parse(pairs.get("redirect_uri").ok_or("Missing test redirect")?).unwrap();
        let address=format!("127.0.0.1:{}",redirect.port().unwrap());
        let state=pairs.get("state").ok_or("Missing test state")?.clone();
        tokio::spawn(async move {
            let mut stream=tokio::net::TcpStream::connect(&address).await.unwrap();
            stream.write_all(format!("GET /?state={state}&code=native-mock-subject HTTP/1.1\r\nHost: {address}\r\n\r\n").as_bytes()).await.unwrap();
            let mut ignored=Vec::new(); let _=stream.read_to_end(&mut ignored).await;
        });
        Ok(())
    }).await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn raw(query: &str) -> String {
        format!("GET /?{query} HTTP/1.1\r\nHost: 127.0.0.1:1234\r\n\r\n")
    }
    #[test]
    fn pkce_matches_rfc7636_and_random_verifiers_differ() {
        assert_eq!(
            challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        let a = verifier();
        let b = verifier();
        assert_eq!(a.len(), 96);
        assert_ne!(a, b);
        assert_eq!(challenge(&a).len(), 43);
    }
    #[test]
    fn callback_rejects_forgery_duplicates_wrong_host_and_denial_state() {
        for query in [
            "code=secret",
            "state=wrong&code=secret",
            "state=valid&state=valid&code=secret",
            "state=valid&code=a&code=b",
            "state=valid&error=access_denied&code=a",
            "state=wrong&error=access_denied",
        ] {
            assert!(callback(&raw(query), 1234, "valid").unwrap().is_none());
        }
        assert!(callback(
            &raw("state=valid&code=secret").replace("Host: 127.0.0.1:1234", "Host: evil.test"),
            1234,
            "valid"
        )
        .unwrap()
        .is_none());
        assert_eq!(
            callback(&raw("state=valid&code=secret"), 1234, "valid")
                .unwrap()
                .unwrap()
                .unwrap(),
            "secret"
        );
        assert!(
            callback(&raw("state=valid&error=access_denied"), 1234, "valid")
                .unwrap()
                .unwrap()
                .unwrap_err()
                .contains("declined")
        );
    }
    #[tokio::test]
    async fn actual_loopback_listener_accepts_code_and_denial_and_times_out() {
        for query in ["state=valid&code=secret", "state=valid&error=access_denied"] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let send = async {
                let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
                stream
                    .write_all(
                        format!("GET /?{query} HTTP/1.1\r\nHost: {address}\r\n\r\n").as_bytes(),
                    )
                    .await
                    .unwrap();
                let mut response = String::new();
                stream.read_to_string(&mut response).await.unwrap();
                assert!(response.starts_with("HTTP/1.1 200"));
                assert!(!response.contains("secret"));
                assert!(!response.contains("state="));
                assert!(response.contains("no-store") && response.contains("no-referrer"));
            };
            let (result, _) = tokio::join!(
                wait_callback(&listener, "valid", Duration::from_secs(2)),
                send
            );
            if query.contains("error=") {
                assert!(result.unwrap_err().contains("declined"));
            } else {
                assert_eq!(result.unwrap(), "secret");
            }
        }
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        assert!(wait_callback(&listener, "valid", Duration::from_millis(5))
            .await
            .unwrap_err()
            .contains("timed out"));
    }
    #[tokio::test]
    async fn cancellation_interrupts_pending_callback() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let (sender, mut receiver) = watch::channel(false);
        sender.send(true).unwrap();
        tokio::select! { biased;
            _ = cancelled(&mut receiver) => {},
            _ = wait_callback(&listener,"valid",Duration::from_secs(300)) => panic!("Cancellation lost"),
        }
    }
    #[test]
    fn browser_opens_only_fixed_google_endpoint_with_bound_parameters() {
        let mut u = Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
        u.query_pairs_mut().extend_pairs([
            ("redirect_uri", "http://127.0.0.1:1234/"),
            ("state", "state"),
            ("code_challenge", "pkce"),
            ("response_type", "code"),
            ("code_challenge_method", "S256"),
            ("scope", "openid email"),
            ("prompt", "select_account"),
            ("nonce", "nonce"),
            ("client_id", "configured"),
        ]);
        assert!(authorization_url(u.as_str(), "http://127.0.0.1:1234/", "state", "pkce").is_ok());
        for url in [
            u.as_str().replace("accounts.google.com", "evil.test"),
            u.as_str().replace("https:", "http:"),
            format!("{}&state=other", u.as_str()),
        ] {
            assert!(authorization_url(&url, "http://127.0.0.1:1234/", "state", "pkce").is_err());
        }
    }
}
