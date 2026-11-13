# Google sign-in: external setup and local verification

2026-11-13. Code/local tests only. No Google project, credentials, brand submission, service activation or deployment was created by this task. Protocol: [google-auth-contract.md](google-auth-contract.md).

## Exact Google Cloud settings needed

1. In the owner's Google Cloud project **Wipster**, open **Google Auth Platform → Branding/Audience/Data Access/Clients**. Choose **External**, publishing status **Testing**, and add the owner's own Google email as a test user. Supply Wipster app name, support email and developer contact. For published branding supply the owner's verified domain, home page and privacy-policy URL. These URLs and contacts must be real owner-controlled values; none were invented or provisioned here.
2. In **Clients → Create client** select application type **Desktop app** and name it **Wipster Desktop**. This implementation supports native macOS/Windows desktop loopback, not the Web application, Android or iOS client types. Copy its `client_id` to server `GOOGLE_CLIENT_ID`. If using the downloaded Desktop `client_secret`, set `GOOGLE_CLIENT_SECRET` on the server only (optional under Google's Desktop protocol). Never place credentials in React/VITE variables, browser storage, Tauri config, source control or logs. A Desktop client is a public client; its secret is not used as proof of native app identity.
3. The exact redirect pattern is **`http://127.0.0.1:<OS-assigned-ephemeral-port>/`**, path `/`, with the actual port bound before starting each attempt. It is repeated byte-for-byte at code exchange. Desktop clients support dynamic loopback ports; there is **no fixed HTTPS callback/authorized JavaScript origin to register** in a Web client. Do not use `urn:ietf:wg:oauth:2.0:oob`, a custom scheme, `localhost`, a remote callback, or a fixed deployment callback with this implementation. The API origin **`https://wipster.fedotovs.net`** is configured separately in Wipster and is not Google's redirect URI.
4. Request only **`openid email`**. These basic sign-in scopes are non-sensitive. `profile` is not requested; name is displayed only when already present in the verified ID token, otherwise email is the label. No Drive/Gmail/API, offline access or refresh-token scope/permission is needed for sync. Leave the app in **Testing** and add the owner's explicitly authorized test accounts for initial real-provider acceptance.
5. Enable Google on the existing API and leave SMS disabled as below. The same client ID is used for the authorization request, server exchange and strict ID-token audience check. Do not substitute an unrelated Web client or accept arbitrary client IDs supplied by a caller.
6. Before public publication review Google's current branding requirements. An External, Published app displaying a custom app name/logo requires brand verification, which may be automatic or manual. Testing/development is exempt under the documented conditions; non-sensitive scopes do **not** mean all branding review is unnecessary.

Official sources rechecked 2026-11-13: [Desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification). Mobile requires its own official platform flow and credentials before it can be supported.

## Confirmed target and deployment handoff

The owner's confirmed API origin is **`https://wipster.fedotovs.net`** on the existing server SSH alias **`msf`**. The native account form defaults to that origin when no explicit origin was saved; an existing saved origin or signed-in account origin is preserved. For local tests explicitly choose `http://127.0.0.1:8080`. The domain is the Wipster API endpoint, **not a Google OAuth callback**; no Web callback URI at that domain is required for this Desktop client.

A separate worker owns CI/CD, scripts and ingress preparation, with protection of existing services as a requirement. Auth/client/backend work coordinates through this contract and [deployment-auth-handoff.md](deployment-auth-handoff.md), without concurrent edits to deployment workflows/scripts. The lead independently accepted corrected auth code (confirmed command `596bf3c8-d503-e786-a2b9-278935b9f2ea`) and reviewed the deployment package. Deployment integration is authorized to commit/push accepted source and run verification-only CI. Production rollout remains closed while real credentials are missing. Owner Google Client ID/JSON is still pending; production fails closed without the configured ID. `client_secret` is optional in the official Desktop token flow and is sent only when supplied server-side. No production Google E2E is established without actual client credentials and an authorized owner login.

## Google-only production environment (not deployed)

Use `backend/.env.production.example` through the future deployment's secret manager:

```dotenv
DEBUG=false
SECRET_KEY=<strong-random-50+-character-secret>
DATABASE_URL=postgresql://<private-TLS-PostgreSQL-connection>
ALLOWED_HOSTS=wipster.fedotovs.net
GOOGLE_ENABLED=true
GOOGLE_CLIENT_ID=<owner-Desktop-client-id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<optional-downloaded-Desktop-client-secret>
OTP_PROVIDER=disabled
DEV_OTP_ENABLED=false
```

A configured Google provider removes the Twilio requirement. Missing/malformed enabled Google client ID, no enabled real provider, incomplete explicitly enabled Twilio, development OTP, DEBUG-only flags, weak key, SQLite and unsafe hosts fail closed. Existing phone-issued sessions continue to authorize data even with SMS disabled. To retain SMS for new sign-ins explicitly choose `OTP_PROVIDER=twilio` and configure all three existing Twilio credentials; no SMS was sent here.

Use normal migrations, readiness checks, TLS ingress and backup procedures in `backend/README.md`. Migration `accounts.0004` changes only phone nullability and adds identities/attempts; existing UUIDs, phone values, session hashes, entity/feed/receipt foreign keys and sequences stay unchanged. Rollback is a reviewed forward migration once phone-less accounts exist; never blindly reverse phone nullability on working data. No deployment workflow has been activated or adapted in this task.

## Local Google-only setup with owner credentials

Export `GOOGLE_ENABLED=true`, the owner's Desktop `GOOGLE_CLIENT_ID` and optional server `GOOGLE_CLIENT_SECRET`, then:

```sh
# Defaults keep SMS and development OTP disabled.
docker compose up --build -d --wait
```

Compose passes the Google/provider environment explicitly and binds API/PostgreSQL to loopback; it does not automatically load `backend/.env`. In the debug Tauri app set API origin `http://127.0.0.1:8080`. Choose import explicitly or open cloud data, then **Sign in with Google**. Google opens in the system browser; the app waits up to five minutes and offers cancellation/retry. Real provider acceptance needs owner credentials and an authorized owner login, neither available in this run. Browser-only Wipster and mobile sign-in are not supported by this desktop flow.

For an existing phone account, use its current signed-in device and **Link Google** before signing out. The link is bound to that exact unrevoked device session. Linking preserves the account, workspaces and all cloud data. A Google identity already owned by another account returns a collision; it never merges data. If no session remains, temporarily retain the optional SMS adapter for sign-in/linking under a separately authorized rollout. Signing in with Google without linking creates/opens the Google account, even if an email coincides. All original/offline/account workspaces remain on disk. Email-code fallback/recovery is future product work.

For the existing no-SMS local phone simulator, explicitly export `OTP_PROVIDER=development DEV_OTP_ENABLED=true` with the DEBUG Compose stack; retrieve codes via `manage.py dev_otp` as before. It is not a production alternative.

## Reproducible provider-mocked native HTTP verification

Use a new isolated Compose project/database and an unused loopback port. The following fixture is only a test harness; normal WSGI/settings never select it. It refuses to import without **DEBUG + DEV_OTP_ENABLED + WIPSTER_GOOGLE_TEST_PROVIDER=1 + GOOGLE_ENABLED**. Native browser injection is compiled only under `cfg(test)` and has no IPC/runtime bypass. The fixture mocks Google's HTTPS token/JWKS responses with ephemeral RSA-signed ID tokens; the real PyJWT signature/issuer/audience/nonce verification and all normal account/session/sync transactions still run.

```sh
docker compose -p wipster-google-verify up -d --wait db
export DEBUG=true DEV_OTP_ENABLED=true OTP_PROVIDER=disabled
export GOOGLE_ENABLED=true GOOGLE_CLIENT_ID=local-test.apps.googleusercontent.com
export DATABASE_URL=postgresql://wipster:local-development-only@127.0.0.1:54329/wipster
backend/.venv/bin/python backend/manage.py migrate --noinput
# In one terminal:
(cd backend && WIPSTER_GOOGLE_TEST_PROVIDER=1 .venv/bin/gunicorn tests_cloud.google_mock_wsgi:application --bind 127.0.0.1:8080 --workers 2)
# In another terminal:
WIPSTER_TEST_API=http://127.0.0.1:8080 cargo test --locked --manifest-path src-tauri/Cargo.toml --lib native_google_two_device_sessions_over_http -- --ignored
```

Stop the fixture after testing. For the original native phone HTTP regression, use normal `project.wsgi:application`, `OTP_PROVIDER=development DEV_OTP_ENABLED=true`, the same isolated DB env for both API and the native test's `dev_otp` command, and run `native_two_clients_http_offline_retry_conflict_delete -- --ignored`. No app data directory or owner credentials are used.

## Retention and known acceptance boundaries

Attempts expire after five minutes; single-use consumption and cancellation are durable across workers. Global/IP quotas bound creation/exchange/cancel. Schedule reviewed deletion of expired/consumed attempts and expired rate buckets, never of sync receipts/feed/tombstones. JWKS caches last at most five minutes and refresh on unknown key IDs; network timeouts, fixed Google endpoints, no redirects and bounded JSON protect provider requests. The app/server never log codes, tokens, nonce/proof, verifier, email or provider response bodies. Configure future ingress error tracing to keep these restrictions.

A consumed attempt is not retried after provider failure or a lost HTTP response: begin a new attempt. Cancel closes the native listener and best-effort cancels the server attempt. A completion already committed on the server may survive a lost response/cancel race (especially an explicit link); retry/status does not merge or overwrite data. An unreceived device session is opaque, expires normally and has not entered React. Imported/prepared local workspaces are retained on failed installation; retry without import opens the preserved account workspace.

Not established by mocked tests: real Google consent/token exchange, downloaded owner client configuration, actual OS browser handoff with Google, packaged sign-in/Keychain/restart, Windows packaging, physical two-device use, iOS/Android, production deployment, ingress, provider availability and branding approval. Lead review remains required before acceptance.
