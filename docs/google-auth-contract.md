# Google native authentication contract

Selected before implementation, 2026-11-13. Desktop Tauri only; no provisioning/deployment.

## Flow and trust boundary

Rust binds `127.0.0.1:0`, generates a PKCE verifier with at least 256 bits of entropy and sends its S256 challenge and exact `http://127.0.0.1:<assigned-port>/` redirect to `POST /api/v1/auth/google/start`. The server creates a five-minute attempt, random state/nonce and a 256-bit attempt proof (only its hash is stored). Rust opens the fixed Google authorization endpoint in the system browser with `response_type=code`, `scope=openid email`, `prompt=select_account`, nonce, state and S256 challenge. No embedded webview, OOB redirect, custom scheme, frontend secret or Google refresh credential.

Rust validates the single callback's method, host, path, unique state and code/error parameters; state must match before accepting either success or denial. The callback shows a static no-store/no-referrer page without reflecting inputs. Rust sends code, verifier, state and attempt proof in the HTTPS finish body. Nothing sensitive passes through React. The backend checks the proof, state, verifier/challenge, expiry and bound session for linking under a PostgreSQL row lock and commits single-use consumption **before** any provider exchange. Provider failure or lost completion requires a fresh attempt. Network calls have bounded timeouts and redirects disabled. Google ID tokens are verified using maintained PyJWT/cryptography, fixed trusted JWKS URL with bounded caching/rotation, RS256, trusted issuer, exact configured desktop audience, expiry, issued-at, subject and constant-time nonce comparison. Google access/refresh credentials are discarded; existing hashed per-device Wipster sessions authorize sync.

Native cancellation drops the listener, invalidates the attempt when reachable and never installs a session. The server expiry and single-use consumption remain authoritative across processes/crashes. Start/finish/cancel have durable global and IP quotas; no process-local replay cache. Only public capabilities reach React. A server/client opt-in mock never exists in production: provider mocking is performed by tests at the provider boundary.

## Identity and existing work

The existing Account UUID already scopes sessions, feed, entities, receipts and native workspaces and remains unchanged. Migration makes unique phone nullable and adds unique `(issuer, subject)` external identities. Google email is display metadata only. Matching emails/phones never link or merge accounts. Two devices with the same verified Google subject get the same account and independent revocable sessions.

Explicit linking starts from a signed-in session and binds the attempt to that exact session. The account is held with PostgreSQL `FOR NO KEY UPDATE`: it serializes with sync/logout's existing `FOR UPDATE` while allowing a concurrent normal login's deferred device-session FK `KEY SHARE` to commit. A stronger account `FOR UPDATE` here would deadlock with a normal login already holding the identity row. The stored session is rechecked after acquiring the account lock and again after provider exchange; identity ownership locks and collision rules remain unchanged. Finish must present it again, and checks revocation/expiry transactionally. An identity owned by another account is rejected without changing either account. Linking changes no workspace or session. Without explicit linking, an existing phone account and a first Google sign-in are separate accounts even if email matches. Original local data and all account workspaces remain intact.

Google sign-in reuses the existing import preview/empty-account guard, separate SQLite workspace, local integration copy, OS credential storage and process restart. Old phone metadata and revocation queues deserialize with defaults. Sync journal/feed/conflict/WIP code is unchanged.

## Confirmed API target and deployment coordination

Public API origin: **`https://wipster.fedotovs.net`**; existing server alias **`msf`**. This is separate from Google's unchanged Desktop redirect **`http://127.0.0.1:<random-port>/`**. New client forms default to the public HTTPS origin; saved custom/local origins and current account origins are retained so existing workspaces are never silently redirected.

The owner will supply the **Wipster** project's **Wipster Desktop** Desktop OAuth client ID/JSON later (External, Testing, owner's tester email, `openid email`). `GOOGLE_CLIENT_SECRET` remains optional under the official Desktop token protocol, server-only when supplied. Never hardcode an OAuth ID or substitute the public API domain as a Web callback.

A separate deployment worker owns scripts/workflows/ingress and protects other services on `msf`. Required backend contract: `DEBUG=false`, `GOOGLE_ENABLED=true`, supplied Desktop `GOOGLE_CLIENT_ID`, `OTP_PROVIDER=disabled`, `DEV_OTP_ENABLED=false`, exact `ALLOWED_HOSTS=wipster.fedotovs.net`, strong secret, private PostgreSQL and trusted TLS ingress. `TRUST_PROXY_TLS=true` only behind the documented ingress that overwrites its forwarding header. Capabilities should advertise `{google:true,sms:false}` after configuration; health/readiness and one migration release job are unchanged. See [deployment handoff](deployment-auth-handoff.md) for the separate ingress/quotas boundary. This worker does not edit or run deployment scripts/workflows, push, SSH or roll out. Deployment must wait for lead auth acceptance; real owner Google login remains separately unverified.

## Configuration and limits

Google is the primary UI action when enabled. SMS appears only when capabilities advertises a configured enabled adapter. Production requires at least one configured real provider and fails closed on unsafe Google/OTP/DEBUG configuration; Twilio is optional when Google is enabled. No email-code system is introduced. External Google project/client/branding setup and real-provider/package acceptance are documented separately; provider-mocked tests do not establish real Google E2E or mobile support.

References checked 2026-11-13:
- https://developers.google.com/identity/protocols/oauth2/native-app
- https://developers.google.com/identity/openid-connect/openid-connect
- https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification
- https://pyjwt.readthedocs.io/en/stable/usage.html
