//! Native-only cloud transport. Bearer credentials never cross the IPC boundary.
use super::cloud_db as journal;
use crate::db::{connection::DbState, migrations};
use journal::Result;
use reqwest::{Client, Method, Url};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{AppHandle, Manager, State};

#[derive(Clone, Serialize, Deserialize)]
pub struct Active {
    pub origin: String,
    pub account_id: String,
    #[serde(default)]
    pub phone: Option<String>,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub google_linked: bool,
    pub credential_id: String,
}
#[derive(Default)]
pub struct Runtime {
    pub active: Option<Active>,
    pub error: Option<String>,
    pub last_sync: Option<String>,
}
pub struct CloudState(pub tokio::sync::Mutex<Runtime>);

pub fn data_dir(app: &AppHandle) -> Result<PathBuf> {
    #[cfg(debug_assertions)]
    if let Some(path) = std::env::var_os("WIPSTER_DEV_DATA_DIR") {
        let path = PathBuf::from(path);
        if !path.is_absolute() {
            return Err("WIPSTER_DEV_DATA_DIR must be absolute".into());
        }
        return Ok(path);
    }
    app.path()
        .app_data_dir()
        .map_err(|_| "Cannot locate app data".into())
}

fn metadata_path(app: &AppHandle) -> Result<PathBuf> {
    Ok(data_dir(app)?.join("cloud-active.json"))
}
pub fn load(app: &AppHandle) -> Result<Option<Active>> {
    let p = metadata_path(app)?;
    if !p.exists() {
        return Ok(None);
    }
    let active: Active =
        serde_json::from_slice(&std::fs::read(p).map_err(|_| "Cannot read cloud workspace")?)
            .map_err(|_| "Invalid cloud workspace metadata")?;
    origin(&active.origin)?;
    uuid::Uuid::parse_str(&active.credential_id).map_err(|_| "Invalid credential identity")?;
    uuid::Uuid::parse_str(&active.account_id).map_err(|_| "Invalid cloud account")?;
    Ok(Some(active))
}
pub fn workspace(app: &AppHandle, active: Option<&Active>) -> Result<PathBuf> {
    let root = data_dir(app)?;
    match active {
        None => Ok(root.join("wipster.db")),
        Some(a) => {
            let hash = format!(
                "{:x}",
                Sha256::digest(format!("{}|{}", a.origin, a.account_id).as_bytes())
            );
            Ok(root.join(format!("cloud-{hash}.db")))
        }
    }
}
fn open(path: &Path) -> Result<Connection> {
    let c = Connection::open(path).map_err(|_| "Cannot open workspace")?;
    c.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;")
        .map_err(|e| e.to_string())?;
    migrations::run(&c).map_err(|e| e.to_string())?;
    Ok(c)
}
pub(super) fn persist(app: &AppHandle, active: Option<&Active>) -> Result<()> {
    let path = metadata_path(app)?;
    if let Some(a) = active {
        let temp = path.with_extension("tmp");
        std::fs::write(
            &temp,
            serde_json::to_vec(a).map_err(|_| "Cannot encode workspace")?,
        )
        .map_err(|_| "Cannot save workspace")?;
        std::fs::rename(temp, path).map_err(|_| "Cannot save workspace")?;
    } else if path.exists() {
        std::fs::remove_file(path).map_err(|_| "Cannot clear workspace")?;
    }
    Ok(())
}
fn entry(a: &Active) -> Result<keyring::Entry> {
    keyring::Entry::new(
        "com.wipster.cloud",
        &format!("{}|{}|{}", a.origin, a.account_id, a.credential_id),
    )
    .map_err(|_| "OS credential store unavailable".into())
}
pub(super) fn token(a: &Active) -> Result<String> {
    entry(a)?.get_password().map_err(|_| {
        "Session unavailable in OS credential store. Sign out and sign in again.".into()
    })
}

pub fn origin(raw: &str) -> Result<String> {
    let u = Url::parse(raw.trim())
        .map_err(|_| "Enter the API origin, for example https://wipster.fedotovs.net")?;
    let loopback = matches!(u.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if u.scheme() != "https" && !(cfg!(debug_assertions) && u.scheme() == "http" && loopback) {
        return Err("The cloud API requires HTTPS (debug builds allow loopback HTTP)".into());
    }
    if !u.username().is_empty()
        || u.password().is_some()
        || u.query().is_some()
        || u.fragment().is_some()
        || u.path() != "/"
    {
        return Err("Enter only the API origin, without path or credentials".into());
    }
    Ok(u.as_str().trim_end_matches('/').to_string())
}
fn client() -> Result<Client> {
    Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Cannot initialize cloud transport".into())
}
pub(super) async fn request(
    origin: &str,
    method: Method,
    path: &str,
    credential: Option<&str>,
    body: Option<&Value>,
) -> Result<(u16, Value)> {
    let mut req = client()?.request(method, format!("{origin}/api/v1/{path}"));
    if let Some(t) = credential {
        req = req.bearer_auth(t);
    }
    if let Some(b) = body {
        req = req.json(b);
    }
    let response = req
        .send()
        .await
        .map_err(|_| "Cloud unavailable. Changes are saved locally; retry when online.")?;
    let status = response.status().as_u16();
    // Bound response memory even with a misconfigured endpoint.
    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Cloud response interrupted")?
    {
        if bytes.len() + chunk.len() > 16 * 1024 * 1024 {
            return Err("Cloud response exceeds client limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let data = serde_json::from_slice(&bytes).map_err(|_| "Unexpected cloud response")?;
    Ok((status, data))
}
pub(super) fn api_error(status: u16, body: &Value) -> String {
    let code = body["error"].as_str().unwrap_or("request_failed");
    // Never display arbitrary provider responses, URLs, credentials or request bodies.
    match code {
        "google_disabled" | "sms_disabled" => {
            "This sign-in method is disabled on the server.".into()
        }
        "invalid_google_login" | "invalid_google_request" => {
            "Google sign-in expired or was rejected. Please try again.".into()
        }
        "google_unavailable" => {
            "Google sign-in is temporarily unavailable. Please try again.".into()
        }
        "google_identity_in_use" => {
            "This Google account belongs to another Wipster account. No accounts were merged."
                .into()
        }
        "rate_limited" => "Too many attempts. Try again later.".into(),
        "invalid_phone" => "Enter a valid phone number in E.164 format (+country code).".into(),
        "invalid_verification" => "The code is invalid, expired or already used.".into(),
        "provider_unavailable" => "Phone verification is temporarily unavailable.".into(),
        "unauthorized" => "Session expired or revoked. Sign out and sign in again.".into(),
        "conflict" => "Cloud conflict. Choose which changes to keep in Account settings.".into(),
        "import_requires_empty_account" => {
            "Import stopped: the cloud account already contains data. Use cloud to continue.".into()
        }
        "wip_limit" => {
            "Cloud WIP limit reached. Move a task out of Doing or adjust the limit, then retry."
                .into()
        }
        "invalid_data" => {
            format!("Cloud rejected the data schema (HTTP {status}). Local changes are preserved.")
        }
        _ => format!("Cloud request failed (HTTP {status}). Local changes are preserved."),
    }
}

#[tauri::command]
pub fn cloud_import_preview(db: State<'_, DbState>) -> Result<Value> {
    let c = db.0.lock().map_err(|_| "Workspace busy")?;
    let state = journal::snapshot(&c)?;
    let count = |kind: &str| state.keys().filter(|(k, _)| k == kind).count();
    let operations: Vec<Value> = state
        .iter()
        .map(|((k, id), d)| json!({"kind":k,"id":id,"base_version":0,"data":d}))
        .collect();
    let bytes=json!({"batch_id":uuid::Uuid::new_v4().to_string(),"operations":operations,"require_empty":true}).to_string().len();
    Ok(
        json!({"projects":count("project"),"tasks":count("task"),"values":count("value"),"entities":state.len(),"bytes":bytes,"can_import":state.len()<=5000 && bytes<=7*1024*1024}),
    )
}

#[tauri::command]
pub async fn cloud_start(origin_url: String, phone: String) -> Result<Value> {
    let o = origin(&origin_url)?;
    let (s, b) = request(
        &o,
        Method::POST,
        "auth/start",
        None,
        Some(&json!({"phone":phone})),
    )
    .await?;
    if s != 200 {
        return Err(api_error(s, &b));
    }
    Ok(b)
}

#[tauri::command]
pub async fn cloud_login(
    app: AppHandle,
    db: State<'_, DbState>,
    cloud: State<'_, CloudState>,
    origin_url: String,
    challenge_id: String,
    code: String,
    import_local: bool,
) -> Result<()> {
    let mut rt = cloud.0.lock().await;
    if rt.active.is_some() {
        return Err("Sign out before changing account".into());
    }
    let _exclusive = db.1.try_write().map_err(|_| {
        "Wait for the assistant or integration request to finish before changing workspace"
    })?;
    let o = origin(&origin_url)?;
    let (s, b) = request(
        &o,
        Method::POST,
        "auth/verify",
        None,
        Some(&json!({"challenge_id":challenge_id,"code":code,"device_name":"Wipster native"})),
    )
    .await?;
    if s != 200 {
        return Err(api_error(s, &b));
    }
    install_session(&app, &db, &mut rt, o, &b, import_local, None).await
}

// Both providers use exactly the same import/workspace/credential/restart path.
pub(super) async fn install_session(
    app: &AppHandle,
    db: &DbState,
    rt: &mut Runtime,
    o: String,
    b: &Value,
    import_local: bool,
    cancelled: Option<&tokio::sync::watch::Receiver<bool>>,
) -> Result<()> {
    let a = Active {
        origin: o,
        account_id: b["account_id"]
            .as_str()
            .ok_or("Invalid account")?
            .to_string(),
        phone: b["phone"].as_str().map(str::to_string),
        email: b["email"].as_str().unwrap_or_default().to_string(),
        name: b["name"].as_str().unwrap_or_default().to_string(),
        google_linked: b["google_linked"].as_bool().unwrap_or(false),
        credential_id: uuid::Uuid::new_v4().to_string(),
    };
    uuid::Uuid::parse_str(&a.account_id).map_err(|_| "Invalid account")?;
    let credential = b["token"].as_str().ok_or("Invalid session")?;
    // Query before touching any workspace. Import is also guarded atomically by the server.
    let (s, feed) = request(
        &a.origin,
        Method::GET,
        "sync/pull?cursor=0&limit=1",
        Some(credential),
        None,
    )
    .await?;
    if s != 200 {
        return Err(api_error(s, &feed));
    }
    let path = workspace(&app, Some(&a))?;
    let existed = path.exists();
    if import_local && (existed || !feed["changes"].as_array().ok_or("Invalid feed")?.is_empty()) {
        let _ = request(
            &a.origin,
            Method::POST,
            "auth/logout",
            Some(credential),
            Some(&json!({})),
        )
        .await;
        return Err("Import is available only for a new workspace and an empty cloud account. Your offline data is unchanged. Sign in using cloud data.".into());
    }
    let mut next = open(&path)?;
    if !existed {
        if import_local {
            let source = db.0.lock().map_err(|_| "Workspace busy")?;
            journal::import_local(&source, &mut next)?;
        } else if feed["changes"].as_array().is_some_and(|c| c.is_empty()) {
            // First cloud workspace publishes the app's built-in field definitions.
            journal::mark_all(&next, false)?;
        }
    }
    // Copy device integrations locally so existing AI/tracker functionality continues;
    // the journal/server allow only wip_limit, so credentials never enter the outbox.
    {
        let source = db.0.lock().map_err(|_| "Workspace busy")?;
        let mut stmt = source
            .prepare("SELECT key,value FROM settings WHERE key!='wip_limit'")
            .map_err(|e| e.to_string())?;
        for r in stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?
        {
            let (k, v) = r.map_err(|e| e.to_string())?;
            next.execute(
                "INSERT OR IGNORE INTO settings(key,value) VALUES(?1,?2)",
                rusqlite::params![k, v],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    if cancelled.is_some_and(|c| *c.borrow()) {
        return Err("Google sign-in cancelled".into());
    }
    entry(&a)?
        .set_password(credential)
        .map_err(|_| "Cannot save session in OS credential store")?;
    persist(&app, Some(&a))?;
    *db.0.lock().map_err(|_| "Workspace busy")? = next;
    rt.active = Some(a);
    rt.error = None;
    rt.last_sync = None;
    // A fresh process prevents late frontend/AI continuations from the old account
    // executing against the newly selected workspace. SQLite commits are durable.
    app.restart()
}

#[tauri::command]
pub async fn cloud_status(
    app: AppHandle,
    db: State<'_, DbState>,
    cloud: State<'_, CloudState>,
) -> Result<Value> {
    let rt = cloud.0.lock().await;
    let c = db.0.lock().map_err(|_| "Workspace busy")?;
    let conflicts: i64 = c
        .query_row("SELECT COUNT(*) FROM sync_conflicts", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    Ok(
        json!({"account":rt.active,"pending":if rt.active.is_some(){journal::dirty_count(&c)?}else{0},"conflict":conflicts>0,"pending_revocations":read_revocations(&app)?.len(),"error":rt.error,"last_sync":rt.last_sync}),
    )
}

async fn synchronize(db: &DbState, a: &Active) -> Result<bool> {
    let credential = token(a)?;
    synchronize_with_token(db, a, &credential).await
}

async fn synchronize_with_token(db: &DbState, a: &Active, credential: &str) -> Result<bool> {
    let pending = {
        let mut c = db.0.lock().map_err(|_| "Workspace busy")?;
        let conflict: i64 = c
            .query_row("SELECT COUNT(*) FROM sync_conflicts", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if conflict > 0 {
            return Err("Resolve the cloud conflict in Account settings".into());
        }
        journal::prepare(&mut c)?
    };
    if let Some(body) = pending {
        let (s, response) = request(
            &a.origin,
            Method::POST,
            "sync/push",
            Some(&credential),
            Some(&body),
        )
        .await?;
        let mut c = db.0.lock().map_err(|_| "Workspace busy")?;
        if s != 200 {
            if s == 409 {
                journal::conflict(&c, &response)?;
            }
            // Validation/WIP rejections are definitive and uncommitted: unfreeze the batch
            // so a local corrective edit can be included on the next attempt.
            if s == 422 {
                c.execute("DELETE FROM sync_pending", [])
                    .map_err(|e| e.to_string())?;
            }
            return Err(api_error(s, &response));
        }
        journal::acknowledge(&mut c, &response)?;
    }
    let mut cursor = {
        let c = db.0.lock().map_err(|_| "Workspace busy")?;
        if journal::dirty_count(&c)? > 0 {
            return Ok(false);
        }
        c.query_row("SELECT MAX(cursor,COALESCE((SELECT MAX(sequence) FROM sync_inbox),0)) FROM sync_control WHERE id=1",[],|r|r.get::<_,i64>(0)).map_err(|e|e.to_string())?
    };
    // Yield after bounded pages; durable inbox is re-fetched idempotently next tick.
    for _ in 0..100 {
        let (s, response) = request(
            &a.origin,
            Method::GET,
            &format!("sync/pull?cursor={cursor}&limit=200"),
            Some(&credential),
            None,
        )
        .await?;
        if s != 200 {
            return Err(api_error(s, &response));
        }
        cursor = response["cursor"].as_i64().ok_or("Invalid cloud cursor")?;
        let mut c = db.0.lock().map_err(|_| "Workspace busy")?;
        journal::stage(&c, &response)?;
        if response["has_more"] == false {
            return journal::apply_inbox(&mut c, cursor);
        }
    }
    Err("Large cloud feed is still downloading; retry to continue.".into())
}

#[tauri::command]
pub async fn cloud_sync(
    app: AppHandle,
    db: State<'_, DbState>,
    cloud: State<'_, CloudState>,
) -> Result<bool> {
    let mut rt = cloud.0.lock().await;
    retry_revocations(&app).await?;
    let Some(a) = rt.active.clone() else {
        return Ok(false);
    };
    let _lease = db.1.read().await;
    let result = synchronize(&db, &a).await;
    match &result {
        Ok(_) => {
            rt.error = None;
            rt.last_sync = Some(chrono::Utc::now().to_rfc3339());
        }
        Err(e) => rt.error = Some(e.clone()),
    }
    result
}

#[tauri::command]
pub async fn cloud_resolve(
    db: State<'_, DbState>,
    cloud: State<'_, CloudState>,
    keep_local: bool,
) -> Result<()> {
    let rt = cloud.0.lock().await;
    if rt.active.is_none() {
        return Err("Sign in first".into());
    }
    let mut c = db.0.lock().map_err(|_| "Workspace busy")?;
    journal::resolve(&mut c, keep_local)
}

#[tauri::command]
pub async fn cloud_logout(
    app: AppHandle,
    db: State<'_, DbState>,
    cloud: State<'_, CloudState>,
) -> Result<()> {
    let mut rt = cloud.0.lock().await;
    let _exclusive = db.1.try_write().map_err(|_| {
        "Wait for the assistant or integration request to finish before changing workspace"
    })?;
    let Some(a) = rt.active.clone() else {
        return Ok(());
    };
    // The queue contains only credential-store identifiers. It survives an offline
    // logout and is retried even when the app has no signed-in account.
    let mut queue = read_revocations(&app)?;
    if !queue.iter().any(|q| q.credential_id == a.credential_id) {
        queue.push(a.clone());
    }
    save_revocations(&app, &queue)?;
    let next = open(&workspace(&app, None)?)?;
    persist(&app, None)?;
    *db.0.lock().map_err(|_| "Workspace busy")? = next;
    rt.active = None;
    rt.error = None;
    rt.last_sync = None;
    // Restart promptly; the next app run retries revocation in the background.
    app.restart()
}

fn revocations_path(app: &AppHandle) -> Result<PathBuf> {
    Ok(metadata_path(app)?.with_file_name("cloud-revocations.json"))
}
fn read_revocations(app: &AppHandle) -> Result<Vec<Active>> {
    let p = revocations_path(app)?;
    if !p.exists() {
        return Ok(Vec::new());
    }
    serde_json::from_slice(
        &std::fs::read(p).map_err(|_| "Cannot read pending session revocations")?,
    )
    .map_err(|_| "Invalid pending session revocations".into())
}
fn save_revocations(app: &AppHandle, entries: &[Active]) -> Result<()> {
    let p = revocations_path(app)?;
    let temp = p.with_extension("tmp");
    std::fs::write(
        &temp,
        serde_json::to_vec(entries).map_err(|_| "Cannot encode session revocations")?,
    )
    .map_err(|_| "Cannot save pending session revocations")?;
    std::fs::rename(temp, p).map_err(|_| "Cannot save pending session revocations".into())
}
async fn retry_revocations(app: &AppHandle) -> Result<()> {
    let queue = read_revocations(app)?;
    if queue.is_empty() {
        return Ok(());
    }
    let mut remaining = queue;
    // Round-robin: one unavailable origin/credential must not starve other sessions.
    let a = remaining.remove(0);
    let mut acknowledged = false;
    if let Ok(t) = token(&a) {
        if let Ok((200 | 401, _)) = request(
            &a.origin,
            Method::POST,
            "auth/logout",
            Some(&t),
            Some(&json!({})),
        )
        .await
        {
            acknowledged = entry(&a)?.delete_credential().is_ok();
        }
    }
    if !acknowledged {
        remaining.push(a);
    }

    save_revocations(app, &remaining)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_phone_active_and_revocation_metadata_remain_compatible() {
        let id = uuid::Uuid::new_v4().to_string();
        let old = json!({"origin":"https://sync.example.com","account_id":id,"phone":"+14155552671","credential_id":id});
        let a: Active = serde_json::from_value(old.clone()).unwrap();
        assert_eq!(a.phone.as_deref(), Some("+14155552671"));
        assert!(a.email.is_empty());
        assert!(!a.google_linked);
        let queue: Vec<Active> = serde_json::from_value(json!([old])).unwrap();
        assert_eq!(queue.len(), 1);
        let google: Active=serde_json::from_value(json!({"origin":a.origin,"account_id":id,"credential_id":id,"phone":null,"email":"person@example.com"})).unwrap();
        assert!(google.phone.is_none());
        assert_eq!(google.email, "person@example.com");
    }

    #[test]
    fn transport_rejects_credential_urls_and_non_tls_remote_servers() {
        for bad in [
            "http://example.com",
            "https://u:p@example.com",
            "https://example.com/api",
            "https://example.com/?token=x",
            "file:///private/data",
        ] {
            assert!(origin(bad).is_err());
        }
        assert_eq!(
            origin("https://example.com/").unwrap(),
            "https://example.com"
        );
        assert_eq!(
            origin("http://127.0.0.1:8080").unwrap(),
            "http://127.0.0.1:8080"
        );
    }

    #[test]
    #[ignore = "creates and removes a temporary credential in the OS credential store"]
    fn native_credential_store_round_trip() {
        let a = Active {
            origin: "https://credential-test.invalid".into(),
            account_id: uuid::Uuid::new_v4().to_string(),
            phone: None,
            email: String::new(),
            name: String::new(),
            google_linked: false,
            credential_id: uuid::Uuid::new_v4().to_string(),
        };
        let temporary = uuid::Uuid::new_v4().to_string() + &uuid::Uuid::new_v4().to_string();
        entry(&a)
            .unwrap()
            .set_password(&temporary)
            .expect("Cannot save temporary OS credential");
        let read = token(&a);
        // Always remove our test entry before asserting. Do not print its value.
        entry(&a)
            .unwrap()
            .delete_credential()
            .expect("Cannot remove temporary OS credential");
        assert!(
            read.as_deref() == Ok(temporary.as_str()),
            "OS credential did not round-trip"
        );
        assert!(token(&a).is_err(), "Removed credential is still accessible");
    }

    #[tokio::test]
    #[ignore = "requires isolated DEBUG Google provider fixture and WIPSTER_TEST_API"]
    async fn native_google_two_device_sessions_over_http() {
        let o = std::env::var("WIPSTER_TEST_API").expect("Set test API origin");
        let (s, caps) = request(&o, Method::GET, "auth/capabilities", None, None)
            .await
            .unwrap();
        assert_eq!(s, 200);
        assert_eq!(caps, json!({"google":true,"sms":false}));
        let first = super::super::cloud_google::test_authorize(&o)
            .await
            .unwrap();
        let second = super::super::cloud_google::test_authorize(&o)
            .await
            .unwrap();
        assert_eq!(first["account_id"], second["account_id"]);
        assert!(first["phone"].is_null());
        assert_ne!(first["token"], second["token"]);
        let a = Active {
            origin: o,
            account_id: first["account_id"].as_str().unwrap().into(),
            phone: None,
            email: first["email"].as_str().unwrap().into(),
            name: String::new(),
            google_linked: true,
            credential_id: uuid::Uuid::new_v4().to_string(),
        };
        let directory = tempfile::tempdir().unwrap();
        let p1 = directory.path().join("one.db");
        let p2 = directory.path().join("two.db");
        let one = DbState::new(open(&p1).unwrap());
        let two = DbState::new(open(&p2).unwrap());
        let token1 = first["token"].as_str().unwrap();
        let token2 = second["token"].as_str().unwrap();
        one.0
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO tasks(id,title) VALUES('google-task','offline work')",
                [],
            )
            .unwrap();
        synchronize_with_token(&one, &a, token1).await.unwrap();
        drop(one);
        let one = DbState::new(open(&p1).unwrap());
        assert!(synchronize_with_token(&two, &a, token2).await.unwrap());
        assert_eq!(
            two.0
                .lock()
                .unwrap()
                .query_row("SELECT title FROM tasks WHERE id='google-task'", [], |r| {
                    r.get::<_, String>(0)
                })
                .unwrap(),
            "offline work"
        );
        let (s, _) = request(
            &a.origin,
            Method::POST,
            "auth/logout",
            Some(token1),
            Some(&json!({})),
        )
        .await
        .unwrap();
        assert_eq!(s, 200);
        assert!(synchronize_with_token(&one, &a, token1).await.is_err());
        assert!(!synchronize_with_token(&two, &a, token2).await.unwrap());
        let (s, _) = request(
            &a.origin,
            Method::POST,
            "auth/logout",
            Some(token2),
            Some(&json!({})),
        )
        .await
        .unwrap();
        assert_eq!(s, 200);
    }

    async fn development_session(o: &str, phone: &str) -> (Active, String) {
        let (s, b) = request(
            &o,
            Method::POST,
            "auth/start",
            None,
            Some(&json!({"phone":phone})),
        )
        .await
        .unwrap();
        assert_eq!(s, 200);
        let challenge = b["challenge_id"].as_str().unwrap();
        let python = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../backend/.venv/bin/python");
        let manage = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../backend/manage.py");
        let output = std::process::Command::new(python)
            .arg(manage)
            .arg("dev_otp")
            .arg(challenge)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "Local development OTP command failed"
        );
        let code = String::from_utf8(output.stdout).unwrap().trim().to_string();
        let (s, b) = request(
            &o,
            Method::POST,
            "auth/verify",
            None,
            Some(&json!({"challenge_id":challenge,"code":code})),
        )
        .await
        .unwrap();
        assert_eq!(s, 200);
        let credential = b["token"].as_str().unwrap().to_string();
        let a = Active {
            origin: o.to_string(),
            account_id: b["account_id"].as_str().unwrap().into(),
            phone: Some(phone.to_string()),
            email: String::new(),
            name: String::new(),
            google_linked: false,
            credential_id: uuid::Uuid::new_v4().to_string(),
        };
        (a, credential)
    }

    /// Opt-in: uses only a local DEBUG development provider and a disposable DB.
    /// No real SMS, no production credentials, no keychain entries.
    #[tokio::test]
    #[ignore = "requires local development API and WIPSTER_TEST_API"]
    async fn native_two_clients_http_offline_retry_conflict_delete() {
        let o = origin(
            &std::env::var("WIPSTER_TEST_API").expect("Set WIPSTER_TEST_API to a local debug API"),
        )
        .unwrap();
        assert!(o.starts_with("http://127.0.0.1:"));
        let phone = format!(
            "+1415555{:04}",
            chrono::Utc::now().timestamp_millis() % 10000
        );
        let (a, first_token) = development_session(&o, &phone).await;
        let credential = first_token.as_str();
        let directory = tempfile::tempdir().unwrap();
        let first_path = directory.path().join("first.db");
        let second_path = directory.path().join("second.db");
        let first = DbState::new(open(&first_path).unwrap());
        let second = DbState::new(open(&second_path).unwrap());
        {
            let c = first.0.lock().unwrap();
            c.execute(
                "INSERT INTO projects(id,name) VALUES('p','Native project')",
                [],
            )
            .unwrap();
            c.execute("INSERT INTO tasks(id,title,project_id,status) VALUES('t','offline task','p','queue')",[]).unwrap();
        }
        synchronize_with_token(&first, &a, credential)
            .await
            .unwrap();
        // Respect the durable production-shaped phone cooldown; no test bypass
        // or fixed code. A different single-use challenge creates device B.
        tokio::time::sleep(Duration::from_secs(61)).await;
        let (b, second_token) = development_session(&o, &phone).await;
        assert!(first_token != second_token, "Device sessions must differ");
        assert_eq!(a.account_id, b.account_id);
        synchronize_with_token(&second, &b, &second_token)
            .await
            .unwrap();
        assert_eq!(
            second
                .0
                .lock()
                .unwrap()
                .query_row("SELECT title FROM tasks WHERE id='t'", [], |r| r
                    .get::<_, String>(0))
                .unwrap(),
            "offline task"
        );
        // Offline edit and frozen outbox survive a failed delivery to a closed port.
        first
            .0
            .lock()
            .unwrap()
            .execute("UPDATE tasks SET title='offline edit' WHERE id='t'", [])
            .unwrap();
        let frozen = {
            let mut c = first.0.lock().unwrap();
            journal::prepare(&mut c).unwrap().unwrap()
        };
        drop(first);
        let first = DbState::new(open(&first_path).unwrap());
        drop(second);
        let second = DbState::new(open(&second_path).unwrap());
        let bad = Active {
            origin: "http://127.0.0.1:1".into(),
            ..a.clone()
        };
        assert!(synchronize_with_token(&first, &bad, credential)
            .await
            .is_err());
        assert_eq!(
            journal::prepare(&mut first.0.lock().unwrap())
                .unwrap()
                .unwrap(),
            frozen
        );
        // Simulate a committed push whose acknowledgement was lost. The next
        // delivery must reuse the frozen batch and receive its original receipt.
        let (s, _) = request(
            &a.origin,
            Method::POST,
            "sync/push",
            Some(credential),
            Some(&frozen),
        )
        .await
        .unwrap();
        assert_eq!(s, 200);
        drop(first);
        let first = DbState::new(open(&first_path).unwrap());
        synchronize_with_token(&first, &a, credential)
            .await
            .unwrap();
        // Device B edits stale work: explicit conflict, then explicit rebase.
        second
            .0
            .lock()
            .unwrap()
            .execute("UPDATE tasks SET title='device B edit' WHERE id='t'", [])
            .unwrap();
        assert!(synchronize_with_token(&second, &b, &second_token)
            .await
            .is_err());
        journal::resolve(&mut second.0.lock().unwrap(), true).unwrap();
        synchronize_with_token(&second, &b, &second_token)
            .await
            .unwrap();
        synchronize_with_token(&first, &a, credential)
            .await
            .unwrap();
        assert_eq!(
            first
                .0
                .lock()
                .unwrap()
                .query_row("SELECT title FROM tasks WHERE id='t'", [], |r| r
                    .get::<_, String>(0))
                .unwrap(),
            "device B edit"
        );
        second
            .0
            .lock()
            .unwrap()
            .execute("DELETE FROM tasks WHERE id='t'", [])
            .unwrap();
        synchronize_with_token(&second, &b, &second_token)
            .await
            .unwrap();
        synchronize_with_token(&first, &a, credential)
            .await
            .unwrap();
        assert_eq!(
            first
                .0
                .lock()
                .unwrap()
                .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        // Each batch is legal (<7 MiB UTF-8), but their combined feed is >16 MiB.
        // The Unicode batch previously committed then deadlocked on its huge ack.
        for group in 0..4 {
            {
                let c = first.0.lock().unwrap();
                let comment = if group == 3 {
                    "я".repeat(50000)
                } else {
                    "x".repeat(100000)
                };
                for index in 0..60 {
                    let id = format!("large-{group}-{index}");
                    c.execute(
                        "INSERT INTO tasks(id,title,comment) VALUES(?1,?1,?2)",
                        rusqlite::params![id, comment],
                    )
                    .unwrap();
                }
            }
            assert!(
                !synchronize_with_token(&first, &a, credential)
                    .await
                    .unwrap(),
                "Own acknowledged echoes are not applied changes"
            );
        }
        let cursor = journal::cursor(&second.0.lock().unwrap()).unwrap();
        let (status, page) = request(
            &b.origin,
            Method::GET,
            &format!("sync/pull?cursor={cursor}&limit=200"),
            Some(&second_token),
            None,
        )
        .await
        .unwrap();
        assert_eq!(status, 200);
        assert_eq!(page["has_more"], true);
        journal::stage(&second.0.lock().unwrap(), &page).unwrap();
        assert_eq!(
            second
                .0
                .lock()
                .unwrap()
                .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        drop(second);
        let second = DbState::new(open(&second_path).unwrap());
        assert!(synchronize_with_token(&second, &b, &second_token)
            .await
            .unwrap());
        assert_eq!(
            second
                .0
                .lock()
                .unwrap()
                .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            240
        );
        assert_eq!(
            second
                .0
                .lock()
                .unwrap()
                .query_row("SELECT comment FROM tasks WHERE id='large-3-0'", [], |r| {
                    r.get::<_, String>(0)
                })
                .unwrap(),
            "я".repeat(50000)
        );
        assert_eq!(
            second
                .0
                .lock()
                .unwrap()
                .query_row(
                    "SELECT SUM(length(CAST(comment AS BLOB))) FROM tasks",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            24_000_000
        );
        let (s, _) = request(
            &a.origin,
            Method::POST,
            "auth/logout",
            Some(credential),
            Some(&json!({})),
        )
        .await
        .unwrap();
        assert_eq!(s, 200);
        assert!(synchronize_with_token(&first, &a, credential)
            .await
            .is_err());
        assert!(!synchronize_with_token(&second, &b, &second_token)
            .await
            .unwrap());
        let (status, _) = request(
            &b.origin,
            Method::POST,
            "auth/logout",
            Some(&second_token),
            Some(&json!({})),
        )
        .await
        .unwrap();
        assert_eq!(status, 200);
        assert!(synchronize_with_token(&second, &b, &second_token)
            .await
            .is_err());
    }
}
